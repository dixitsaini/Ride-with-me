import { registerPermissionSource } from "../permissions";
import { createLogger } from "../logger";
import {
  createReactNativeAppStateSource,
  type LocationAppStateSource,
} from "./appStateSource";
import type {
  BackgroundLocationService,
  BackgroundLocationStartOptions,
} from "./backgroundLocation";
import { addBackgroundLocationSink } from "./backgroundSink";
import {
  DEFAULT_LOCATION_STALE_THRESHOLD_MS,
  isLocationPermissionUsable,
  transitionLocationState,
  type EngineBackgroundStatus,
  type LocationAppState,
  type LocationBufferState,
  type LocationEngineStatus,
  type LocationPermissionState,
  type LocationPublisherState,
  type LocationSample,
  type LocationSamplePublisher,
  type LocationService,
  type LocationState,
} from "./index";
import {
  createPersistentLocationBuffer,
  type LocationBuffer,
} from "./persistentBuffer";
import {
  createSampleGate,
  type SampleGate,
  type SampleGateResult,
} from "./sampleGate";
import {
  createSamplingPolicy,
  type LocationSamplingConfig,
  type LocationSamplingPolicy,
  type SamplingPolicyContext,
} from "./samplingPolicy";

export type LocationEngineOptions = {
  provider: LocationService;
  background?: BackgroundLocationService | null;
  policy?: LocationSamplingPolicy;
  buffer?: LocationBuffer;
  publisher?: LocationSamplePublisher | null;
  appStateSource?: LocationAppStateSource;
  context?: SamplingPolicyContext;
  now?: () => number;
  staleThresholdMs?: number;
};

export type LocationEngine = LocationService & {
  getLatestSample: () => LocationSample | null;
  getPendingLocationCount: () => number;
  getPendingLocationState: () => LocationBufferState;
  getStatus: () => LocationEngineStatus;
  getEngineStatus: () => LocationEngineStatus;
  subscribeToStatus: (
    listener: (status: LocationEngineStatus) => void,
  ) => () => void;
  subscribeToEngineStatus: (
    listener: (status: LocationEngineStatus) => void,
  ) => () => void;
  setPublisher: (publisher: LocationSamplePublisher | null) => void;
  setContext: (context: SamplingPolicyContext) => void;
  startBackgroundUpdates: (
    options?: BackgroundLocationStartOptions,
  ) => Promise<EngineBackgroundStatus>;
  stopBackgroundUpdates: () => Promise<EngineBackgroundStatus>;
  getBackgroundStatus: () => EngineBackgroundStatus;
  pauseTracking: () => Promise<void>;
  resumeTracking: () => Promise<void>;
  refresh: () => Promise<LocationEngineStatus>;
  checkFreshness: () => LocationState;
  flush: () => Promise<void>;
  settled: () => Promise<void>;
  dispose: () => void;
};

const RECOVERABLE_STATES = new Set<LocationState>([
  "STALE",
  "GPS_UNAVAILABLE",
  "OFFLINE_BUFFERING",
  "OFFLINE",
  "SYNCING",
  "SUSPENDED",
  "RECOVERING",
  "ERROR",
]);

function toPermissionStatus(
  permission: LocationPermissionState,
): "granted" | "denied" | "blocked" | "limited" | "undetermined" {
  switch (permission) {
    case "GRANTED":
      return "granted";
    case "LIMITED":
      return "limited";
    case "BLOCKED":
      return "blocked";
    case "DENIED":
    case "RESTRICTED":
      return "denied";
    default:
      return "undetermined";
  }
}

export function createLocationEngine(
  options: LocationEngineOptions,
): LocationEngine {
  const log = createLogger("location.engine");
  const now = options.now ?? Date.now;
  const policy = options.policy ?? createSamplingPolicy();
  const buffer = options.buffer ?? createPersistentLocationBuffer({ now });
  const appStateSource =
    options.appStateSource ?? createReactNativeAppStateSource();
  const staleThresholdMs =
    options.staleThresholdMs ?? DEFAULT_LOCATION_STALE_THRESHOLD_MS;

  let context: SamplingPolicyContext = options.context ?? {};
  let config: LocationSamplingConfig = withStaleThreshold(
    policy.resolve(context),
  );
  const gate: SampleGate = createSampleGate(config, { now });

  let publisher: LocationSamplePublisher | null = options.publisher ?? null;
  let state: LocationState = "UNAVAILABLE";
  let permission: LocationPermissionState = "NOT_REQUESTED";
  let requestIssued = false;
  let gpsAvailable = true;
  let appState: LocationAppState = appStateSource.getState();
  let pausedByUser = false;
  let suspended = appState === "background";
  let recovering = false;
  let flushing = false;
  let started = false;
  let disposed = false;
  let updatesActive = false;
  let backgroundActive = false;
  let backgroundDesired = false;
  const backgroundService: BackgroundLocationService | null =
    options.background ?? null;
  let backgroundPermission: LocationPermissionState = "NOT_REQUESTED";
  let backgroundSinkRelease: (() => void) | null = null;
  let sessionSampleReceived = false;
  let publisherState: LocationPublisherState = "IDLE";
  let lastSampleAt: number | null = null;
  let lastAccepted: LocationSample | null = null;
  let lastPublishedAt: number | null = null;
  let engineError: string | null = null;

  let unsubscribeProvider: (() => void) | null = null;
  let unsubscribeAppState: (() => void) | null = null;
  let unregisterPermission: (() => void) | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const locationListeners = new Set<(location: LocationSample) => void>();
  const statusListeners = new Set<(status: LocationEngineStatus) => void>();
  let workChain: Promise<void> = Promise.resolve();

  function withStaleThreshold(
    resolved: LocationSamplingConfig,
  ): LocationSamplingConfig {
    if (options.staleThresholdMs === undefined) {
      return resolved;
    }
    return { ...resolved, staleThresholdMs };
  }

  function track(promise: Promise<unknown>): Promise<void> {
    workChain = workChain.then(() =>
      promise.then(
        () => undefined,
        () => undefined,
      ),
    );
    return workChain;
  }

  function currentConfig(): LocationSamplingConfig {
    return config;
  }

  function status(): LocationEngineStatus {
    const fresh =
      lastSampleAt === null
        ? ("UNKNOWN" as const)
        : now() - lastSampleAt > currentConfig().staleThresholdMs
          ? ("STALE" as const)
          : ("FRESH" as const);

    return {
      state,
      permission,
      gpsAvailable,
      updatesActive,
      pausedByUser,
      suspended,
      appState,
      freshness: fresh,
      accuracy: !lastAccepted
        ? "UNKNOWN"
        : lastAccepted.accuracy > currentConfig().maxPublishableAccuracyMeters
          ? "LOW"
          : "GOOD",
      lastSampleAt,
      lastAcceptedSample: lastAccepted,
      buffer: buffer.snapshot(),
      publisherState,
      connection:
        publisher?.getConnectionState?.() ??
        (publisherState === "ONLINE"
          ? "CONNECTED"
          : publisherState === "IDLE"
            ? "DISCONNECTED"
            : "RECONNECTING"),
      error: engineError,
    };
  }

  function emitStatus() {
    const snapshot = status();
    statusListeners.forEach((listener) => listener(snapshot));
  }

  function setState(next: LocationState) {
    if (state === next) {
      return;
    }
    log.debug("state transition", { from: state, to: next });
    state = next;
    emitStatus();
  }

  function computeState(
    overrides: { recovering?: boolean } = {},
  ): LocationState {
    const resolved = currentConfig();
    const offline = publisherState === "OFFLINE" || publisherState === "FAILED";
    const stale =
      lastSampleAt !== null && now() - lastSampleAt > resolved.staleThresholdMs;
    const lowAccuracy =
      lastAccepted !== null &&
      lastAccepted.accuracy > resolved.maxPublishableAccuracyMeters;

    return transitionLocationState(
      state,
      permission,
      lastAccepted !== null,
      offline,
      stale,
      {
        requested: requestIssued,
        gpsAvailable,
        pausedByUser,
        suspended,
        syncing: flushing,
        buffering: offline && buffer.pendingCount() > 0,
        recovering: overrides.recovering ?? recovering,
        lowAccuracy,
        awaitingFirstSample: !sessionSampleReceived,
      },
    );
  }

  function promoteIfHealthy(next: LocationState): LocationState {
    if (!lastAccepted) {
      return next;
    }
    if (next === "READY" || next === "UNAVAILABLE") {
      return lastAccepted.accuracy >
        currentConfig().maxPublishableAccuracyMeters
        ? "LOW_ACCURACY"
        : "TRACKING";
    }
    return next;
  }

  function scheduleStaleCheck() {
    clearStaleCheck();
    const interval = Math.max(1_000, currentConfig().staleThresholdMs / 3);
    staleTimer = setInterval(() => {
      checkFreshness();
    }, interval);
  }

  function clearStaleCheck() {
    if (staleTimer) {
      clearInterval(staleTimer);
      staleTimer = null;
    }
  }

  function cancelRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry() {
    if (retryTimer || disposed || !started) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, currentConfig().flushRetryDelayMs);
  }

  function registerPermissionSource_() {
    if (unregisterPermission) {
      return;
    }
    unregisterPermission = registerPermissionSource("location", {
      getStatus: async () => toPermissionStatus(permission),
      request: async () => {
        permission = await requestProviderPermission();
        return toPermissionStatus(permission);
      },
    });
  }

  async function requestProviderPermission(): Promise<LocationPermissionState> {
    requestIssued = true;
    if (permission === "NOT_REQUESTED") {
      setState("REQUESTED");
    }
    const next = await (
      options.provider.requestPermission ?? options.provider.permissionState
    )();
    permission = next;
    return permission;
  }

  function stopProviderUpdates() {
    unsubscribeProvider?.();
    unsubscribeProvider = null;
    if (!backgroundActive) {
      updatesActive = false;
    }
  }

  /**
   * Releases the OS watch when permission or location services go away while
   * a session is running. Without this the native watcher keeps running after
   * the OS has already revoked access, and the engine would keep reporting an
   * active session it can no longer satisfy.
   */
  async function releaseForegroundWatch(): Promise<void> {
    const foregroundWatchActive = updatesActive && !backgroundActive;
    await stopBackgroundStream();
    stopProviderUpdates();
    if (!foregroundWatchActive) {
      return;
    }
    try {
      await options.provider.stopTracking();
    } catch {
      // releasing a stale watch must never block recovery
    }
  }

  function ensureProviderSubscription() {
    if (unsubscribeProvider) {
      return;
    }
    unsubscribeProvider = options.provider.subscribe(handleSample, (error) => {
      engineError = error.message;
      setState(computeState());
      emitStatus();
      track(refresh());
    });
  }

  async function startForegroundStream(): Promise<void> {
    if (updatesActive) {
      return;
    }
    try {
      await options.provider.startTracking(config);
      updatesActive = true;
      engineError = null;
    } catch (error) {
      engineError =
        error instanceof Error ? error.message : "Location updates failed";
      updatesActive = false;
    }
  }

  async function startBackgroundStream(
    requestPermission = false,
  ): Promise<boolean> {
    if (!backgroundService) {
      return false;
    }
    if (backgroundActive) {
      // A second start request must not open a second OS stream or re-wire
      // the sink; the running one already owns delivery.
      updatesActive = true;
      return true;
    }

    backgroundPermission = await backgroundService.permissionState();
    const nextState = await backgroundService.start({ requestPermission });
    backgroundPermission = await backgroundService.permissionState();

    if (nextState !== "RUNNING") {
      backgroundActive = false;
      return false;
    }

    backgroundActive = true;
    updatesActive = true;
    suspended = false;
    unsubscribeProvider?.();
    unsubscribeProvider = null;
    backgroundSinkRelease?.();
    backgroundSinkRelease = addBackgroundLocationSink(handleSample);
    try {
      await options.provider.stopTracking();
    } catch {
      // releasing a stale watch must never block background delivery
    }
    engineError = null;
    return true;
  }

  async function stopBackgroundStream(): Promise<void> {
    const wasActive = backgroundActive;
    backgroundActive = false;
    backgroundSinkRelease?.();
    backgroundSinkRelease = null;
    if (wasActive) {
      updatesActive = false;
    }
    if (!backgroundService) {
      return;
    }
    if (wasActive) {
      await backgroundService.stop();
    }
    backgroundPermission = await backgroundService.permissionState();
  }

  async function ensureSession(): Promise<void> {
    if (disposed) {
      return;
    }

    permission = await options.provider.permissionState();
    if (permission === "NOT_REQUESTED") {
      permission = await requestProviderPermission();
    } else {
      requestIssued = true;
    }
    registerPermissionSource_();

    if (!isLocationPermissionUsable(permission)) {
      await releaseForegroundWatch();
      setState(computeState());
      emitStatus();
      return;
    }

    gpsAvailable = (await options.provider.hasServicesEnabled?.()) ?? true;
    if (!gpsAvailable) {
      await releaseForegroundWatch();
      setState(computeState());
      emitStatus();
      return;
    }

    await buffer.load();

    if (backgroundDesired && backgroundService && !updatesActive) {
      const backgroundStarted = await startBackgroundStream();
      if (!backgroundStarted) {
        ensureProviderSubscription();
        await startForegroundStream();
      }
    } else if (!backgroundActive) {
      ensureProviderSubscription();
      await startForegroundStream();
    }

    startStaleCheckIfNeeded();
    if (engineError && !updatesActive) {
      setState("ERROR");
    } else if (pausedByUser) {
      setState("PAUSED_BY_USER");
    } else if (suspended) {
      setState("SUSPENDED");
    } else if (!sessionSampleReceived) {
      setState("AUTHORIZED");
    } else {
      setState(computeState());
    }
    emitStatus();
  }

  function startStaleCheckIfNeeded() {
    if (started && !staleTimer) {
      scheduleStaleCheck();
    }
  }

  function handleSample(raw: LocationSample) {
    if (disposed || pausedByUser) {
      return;
    }

    const result = gate.evaluate(raw);
    if (!result.accepted) {
      emitStatus();
      return;
    }

    if (RECOVERABLE_STATES.has(state)) {
      recovering = true;
      setState("RECOVERING");
    }

    recovering = false;
    sessionSampleReceived = true;
    lastAccepted = raw;
    lastSampleAt = raw.timestamp;

    locationListeners.forEach((listener) => listener(raw));

    void track(acceptSample(raw, result));
  }

  async function acceptSample(
    sample: LocationSample,
    result: SampleGateResult,
  ): Promise<void> {
    const entry = await buffer.append(sample, result.publishable);
    emitStatus();

    if (!result.publishable) {
      setState(promoteIfHealthy(computeState()));
      emitStatus();
      return;
    }

    if (!publisher) {
      publisherState = "IDLE";
      setState(promoteIfHealthy(computeState()));
      emitStatus();
      return;
    }

    await publishSample(sample, entry?.id ?? null);
    emitStatus();
  }

  async function publishSample(
    sample: LocationSample,
    entryId: string | null,
  ): Promise<void> {
    if (!publisher || flushing) {
      return;
    }

    if (lastPublishedAt !== null && sample.timestamp <= lastPublishedAt) {
      if (entryId) {
        await buffer.markReconciled(entryId);
      }
      return;
    }

    if (publisher.isReachable && !publisher.isReachable()) {
      publisherState = "OFFLINE";
      scheduleRetry();
      setState(computeState());
      return;
    }

    try {
      await publisher.publish(sample);
      lastPublishedAt = sample.timestamp;
      publisherState = "ONLINE";
      engineError = null;
      if (entryId) {
        await buffer.markSynced(entryId);
      }
      setState(promoteIfHealthy(computeState()));
    } catch (error) {
      publisherState = "FAILED";
      engineError =
        error instanceof Error ? error.message : "Location publish failed";
      if (entryId) {
        await buffer.markFailed(entryId, engineError);
      }
      log.warn("publish failed", {
        pending: buffer.pendingCount(),
        dropped: buffer.snapshot().dropped,
      });
      scheduleRetry();
      setState(computeState());
    }
  }

  async function flush(): Promise<void> {
    if (disposed || flushing) {
      return;
    }
    if (!publisher) {
      return;
    }

    const pending = buffer.pending();
    if (pending.length === 0) {
      if (publisherState === "OFFLINE" || publisherState === "FAILED") {
        log.info("buffer drained", { pending: 0 });
        publisherState = "ONLINE";
        engineError = null;
        setState(computeState());
        emitStatus();
      }
      return;
    }

    flushing = true;
    setState(computeState());
    emitStatus();

    try {
      for (const entry of pending) {
        if (!entry.publishable) {
          await buffer.markReconciled(entry.id);
          continue;
        }
        if (lastPublishedAt !== null && entry.timestamp <= lastPublishedAt) {
          await buffer.markReconciled(entry.id);
          continue;
        }
        if (publisher.isReachable && !publisher.isReachable()) {
          publisherState = "OFFLINE";
          log.warn("flush interrupted: publisher unreachable", {
            pending: buffer.pendingCount(),
          });
          scheduleRetry();
          return;
        }
        try {
          await publisher.publish(entry);
          lastPublishedAt = entry.timestamp;
          publisherState = "ONLINE";
          engineError = null;
          await buffer.markSynced(entry.id);
        } catch (error) {
          publisherState = "FAILED";
          engineError =
            error instanceof Error ? error.message : "Location publish failed";
          await buffer.markFailed(entry.id, engineError);
          log.warn("flush stopped: publish failed", {
            pending: buffer.pendingCount(),
            dropped: buffer.snapshot().dropped,
          });
          scheduleRetry();
          return;
        }
        emitStatus();
      }
      log.info("buffer synchronized", {
        pending: buffer.pendingCount(),
        dropped: buffer.snapshot().dropped,
      });
    } finally {
      flushing = false;
      setState(promoteIfHealthy(computeState()));
      emitStatus();
    }
  }

  async function refresh(): Promise<LocationEngineStatus> {
    if (disposed) {
      return status();
    }

    const previous = permission;
    const usableBefore = isLocationPermissionUsable(previous);

    permission = await (
      options.provider.refreshPermission ?? options.provider.permissionState
    )();
    registerPermissionSource_();

    if (previous !== permission) {
      log.info("permission changed", { from: previous, to: permission });
    }

    const servicesBefore = gpsAvailable;
    gpsAvailable =
      (await options.provider.hasServicesEnabled?.()) ?? gpsAvailable;
    if (servicesBefore !== gpsAvailable) {
      log.info("location services changed", {
        available: gpsAvailable,
      });
    }

    const usableNow = isLocationPermissionUsable(permission);
    if (!usableNow) {
      await releaseForegroundWatch();
      cancelRetry();
      setState(computeState());
    } else if (!usableBefore) {
      await ensureSession();
    } else if (!gpsAvailable) {
      await releaseForegroundWatch();
      cancelRetry();
      setState(computeState());
    } else if (!updatesActive && started && !pausedByUser && !suspended) {
      await ensureSession();
    } else if (updatesActive && !pausedByUser && !suspended) {
      await restartUpdates();
      if (engineError && !updatesActive) {
        setState("ERROR");
      } else if (!sessionSampleReceived) {
        setState("AUTHORIZED");
      } else {
        setState(promoteIfHealthy(computeState()));
      }
    } else if (engineError && !updatesActive) {
      setState("ERROR");
    } else {
      setState(computeState());
    }

    emitStatus();
    return status();
  }

  async function restartUpdates(): Promise<void> {
    if (backgroundActive) {
      // The OS background stream already owns delivery; restarting the
      // foreground watch here would push every sample through twice.
      return;
    }
    try {
      await options.provider.stopTracking();
    } catch {
      // releasing a stale watch must never block recovery
    }
    updatesActive = false;
    try {
      await options.provider.startTracking(config);
      updatesActive = true;
    } catch (error) {
      engineError =
        error instanceof Error ? error.message : "Location updates failed";
      updatesActive = false;
    }
  }

  function checkFreshness(): LocationState {
    if (disposed || !started || pausedByUser || suspended) {
      return state;
    }
    if (lastSampleAt === null) {
      return state;
    }
    if (now() - lastSampleAt > currentConfig().staleThresholdMs) {
      if (
        state === "TRACKING" ||
        state === "LOW_ACCURACY" ||
        state === "RECOVERING" ||
        state === "AUTHORIZED"
      ) {
        setState("STALE");
      }
    }
    return state;
  }

  async function handleAppStateChange(next: LocationAppState): Promise<void> {
    const previous = appState;
    appState = next;

    if (next === "background" && previous !== "background") {
      if (backgroundActive) {
        // The OS background stream keeps delivering while the app is
        // backgrounded, so the session never suspends.
        emitStatus();
        return;
      }
      suspended = true;
      if (isLocationPermissionUsable(permission) && started) {
        setState("SUSPENDED");
      }
      emitStatus();
      return;
    }

    if (next === "foreground" && previous === "background") {
      suspended = false;
      recovering = true;
      setState("RECOVERING");
      await refresh();
      recovering = false;
      if (started && isLocationPermissionUsable(permission)) {
        if (buffer.pendingCount() > 0) {
          await flush();
        }
        setState(promoteIfHealthy(computeState()));
      }
      emitStatus();
    }
  }

  function ensureAppStateSubscription() {
    if (unsubscribeAppState) {
      return;
    }
    unsubscribeAppState = appStateSource.subscribe((next) => {
      void track(handleAppStateChange(next));
    });
  }

  async function getCurrentLocation(): Promise<LocationSample | null> {
    try {
      const sample = await options.provider.getCurrentLocation();
      if (!sample || disposed) {
        return null;
      }
      const result = gate.evaluate(sample);
      if (!result.accepted) {
        return null;
      }
      if (RECOVERABLE_STATES.has(state)) {
        recovering = true;
        setState("RECOVERING");
      }
      recovering = false;
      sessionSampleReceived = true;
      lastAccepted = sample;
      lastSampleAt = sample.timestamp;
      locationListeners.forEach((listener) => listener(sample));
      await acceptSample(sample, result);
      return sample;
    } catch (error) {
      engineError =
        error instanceof Error ? error.message : "Location request failed";
      emitStatus();
      return null;
    }
  }

  function engineBackgroundStatus(): EngineBackgroundStatus {
    if (!backgroundService) {
      return {
        supported: false,
        state: "UNSUPPORTED",
        permission: "NOT_REQUESTED",
        error: null,
        desired: backgroundDesired,
      };
    }
    return {
      supported: backgroundService.isSupported(),
      state: backgroundService.status(),
      permission: backgroundPermission,
      error: backgroundService.getError(),
      desired: backgroundDesired,
    };
  }

  const engine: LocationEngine = {
    async permissionState() {
      permission = await (
        options.provider.refreshPermission ?? options.provider.permissionState
      )();
      return permission;
    },
    refreshPermission() {
      return engine.permissionState();
    },
    requestPermission() {
      return requestProviderPermission();
    },
    async hasServicesEnabled() {
      gpsAvailable = (await options.provider.hasServicesEnabled?.()) ?? true;
      return gpsAvailable;
    },
    async startTracking() {
      if (disposed) {
        return;
      }
      started = true;
      pausedByUser = false;
      sessionSampleReceived = false;
      ensureAppStateSubscription();
      await ensureSession();
    },
    async stopTracking() {
      started = false;
      pausedByUser = false;
      recovering = false;
      backgroundDesired = false;
      cancelRetry();
      clearStaleCheck();
      await stopBackgroundStream();
      stopProviderUpdates();
      try {
        await options.provider.stopTracking();
      } catch (error) {
        engineError =
          error instanceof Error ? error.message : "Stopping updates failed";
      }
      if (isLocationPermissionUsable(permission)) {
        setState("READY");
      } else {
        setState(computeState());
      }
      emitStatus();
    },
    async pauseTracking() {
      pausedByUser = true;
      clearStaleCheck();
      await stopBackgroundStream();
      stopProviderUpdates();
      try {
        await options.provider.stopTracking();
      } catch {
        // pause must not throw
      }
      setState(computeState());
      emitStatus();
    },
    async resumeTracking() {
      if (disposed || !started) {
        return;
      }
      pausedByUser = false;
      sessionSampleReceived = false;
      await ensureSession();
      if (buffer.pendingCount() > 0) {
        await flush();
      }
      emitStatus();
    },
    getCurrentLocation,
    async startBackgroundUpdates(startOptions = {}) {
      if (disposed) {
        return engineBackgroundStatus();
      }
      backgroundDesired = true;
      if (!backgroundService) {
        return engineBackgroundStatus();
      }
      if (!started || pausedByUser) {
        backgroundPermission = await backgroundService.permissionState();
        return engineBackgroundStatus();
      }

      const backgroundStarted = await startBackgroundStream(
        startOptions.requestPermission ?? true,
      );
      log.debug("background stream start", { started: backgroundStarted });
      if (!backgroundStarted) {
        ensureProviderSubscription();
        await startForegroundStream();
      }
      setState(computeState());
      emitStatus();
      return engineBackgroundStatus();
    },
    async stopBackgroundUpdates() {
      backgroundDesired = false;
      const wasActive = backgroundActive;
      await stopBackgroundStream();
      log.debug("background stream stop", { wasActive });
      if (
        wasActive &&
        started &&
        !pausedByUser &&
        isLocationPermissionUsable(permission)
      ) {
        ensureProviderSubscription();
        await startForegroundStream();
      }
      emitStatus();
      return engineBackgroundStatus();
    },
    getBackgroundStatus() {
      return engineBackgroundStatus();
    },
    subscribe(listener) {
      locationListeners.add(listener);
      return () => {
        locationListeners.delete(listener);
      };
    },
    getTrackingState() {
      return state;
    },
    getErrorState() {
      return engineError
        ? new Error(engineError)
        : options.provider.getErrorState();
    },
    getLatestSample() {
      return lastAccepted;
    },
    getPendingLocationCount() {
      return buffer.pendingCount();
    },
    getPendingLocationState(): LocationBufferState {
      if (flushing) {
        return "SYNCING";
      }
      return buffer.state();
    },
    getStatus: status,
    getEngineStatus: status,
    subscribeToStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    subscribeToEngineStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    setPublisher(next) {
      publisher = next;
      publisherState = next ? "ONLINE" : "IDLE";
      if (next) {
        lastPublishedAt = null;
        cancelRetry();
        if (started && buffer.pendingCount() > 0) {
          void track(flush());
        }
      }
      emitStatus();
    },
    setContext(next) {
      context = { ...context, ...next };
      config = withStaleThreshold(policy.resolve(context));
      gate.configure(config);
      if (staleTimer) {
        scheduleStaleCheck();
      }
      if (updatesActive) {
        void track(restartUpdates());
      }
    },
    checkFreshness,
    refresh,
    flush,
    settled() {
      return workChain;
    },
    dispose() {
      disposed = true;
      started = false;
      backgroundDesired = false;
      backgroundActive = false;
      backgroundSinkRelease?.();
      backgroundSinkRelease = null;
      void backgroundService?.stop();
      cancelRetry();
      clearStaleCheck();
      stopProviderUpdates();
      unsubscribeAppState?.();
      unsubscribeAppState = null;
      unregisterPermission?.();
      unregisterPermission = null;
      locationListeners.clear();
      statusListeners.clear();
      options.provider.dispose?.();
    },
  };

  return engine;
}
