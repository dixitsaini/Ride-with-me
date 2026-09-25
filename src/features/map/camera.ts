import {
  DEFAULT_FOLLOW_REGION_SPAN,
  type CameraMode,
  type MapCameraState,
  type MapCoordinate,
  type MapRegion,
} from "./types";

const MIN_FOLLOW_SPAN = 0.01;
/** ~1.1m; absorbs the rounding the native map applies when settling. */
const EPSILON = 1e-5;

export type MapCameraControllerOptions = {
  getCurrentCoordinate: () => MapCoordinate | null;
  getRiderCoordinate: (riderId: string) => MapCoordinate | null;
  getOtherCoordinates: () => MapCoordinate[];
  onChange: (camera: MapCameraState) => void;
};

export type MapCameraSetModeOptions = {
  selectedRiderId?: string | null;
};

export type MapCameraController = {
  getState: () => MapCameraState;
  setMode: (
    mode: CameraMode,
    options?: MapCameraSetModeOptions,
  ) => MapCameraState;
  /** Called by the map surface when the user drags the map manually. */
  notifyUserGesture: (region: MapRegion) => MapCameraState;
  /** Recomputes the follow region from the latest rider positions. */
  refresh: () => MapCameraState;
  /** Handles a rider disappearing; exits `FOLLOW_SELECTED_RIDER` if needed. */
  handleRiderRemoved: (riderId: string) => MapCameraState;
  reset: () => MapCameraState;
  dispose: () => void;
};

const initialCamera: MapCameraState = {
  mode: "FREE",
  selectedRiderId: null,
  region: null,
  sequence: 0,
  following: false,
};

function sameCoordinate(
  left: MapCoordinate | null,
  right: MapCoordinate | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    Math.abs(left.latitude - right.latitude) < EPSILON &&
    Math.abs(left.longitude - right.longitude) < EPSILON
  );
}

function sameRegion(left: MapRegion | null, right: MapRegion | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    sameCoordinate(left, right) &&
    Math.abs(left.latitudeDelta - right.latitudeDelta) < EPSILON &&
    Math.abs(left.longitudeDelta - right.longitudeDelta) < EPSILON
  );
}

export function isSameMapRegion(
  left: MapRegion | null,
  right: MapRegion | null,
): boolean {
  return sameRegion(left, right);
}

export function regionAround(coordinate: MapCoordinate): MapRegion {
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: DEFAULT_FOLLOW_REGION_SPAN,
    longitudeDelta: DEFAULT_FOLLOW_REGION_SPAN,
  };
}

export function regionContaining(
  coordinates: MapCoordinate[],
): MapRegion | null {
  if (coordinates.length === 0) {
    return null;
  }
  if (coordinates.length === 1) {
    return regionAround(coordinates[0]);
  }

  let minLatitude = coordinates[0].latitude;
  let maxLatitude = coordinates[0].latitude;
  let minLongitude = coordinates[0].longitude;
  let maxLongitude = coordinates[0].longitude;

  for (const coordinate of coordinates) {
    minLatitude = Math.min(minLatitude, coordinate.latitude);
    maxLatitude = Math.max(maxLatitude, coordinate.latitude);
    minLongitude = Math.min(minLongitude, coordinate.longitude);
    maxLongitude = Math.max(maxLongitude, coordinate.longitude);
  }

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.5, MIN_FOLLOW_SPAN),
    longitudeDelta: Math.max(
      (maxLongitude - minLongitude) * 1.5,
      MIN_FOLLOW_SPAN,
    ),
  };
}

export function createMapCameraController(
  options: MapCameraControllerOptions,
): MapCameraController {
  const {
    getCurrentCoordinate,
    getRiderCoordinate,
    getOtherCoordinates,
    onChange,
  } = options;
  let state: MapCameraState = initialCamera;
  let disposed = false;

  const commit = (next: MapCameraState): MapCameraState => {
    if (disposed) {
      return state;
    }
    const unchanged =
      next.mode === state.mode &&
      next.selectedRiderId === state.selectedRiderId &&
      next.sequence === state.sequence &&
      next.following === state.following &&
      sameRegion(next.region, state.region);

    if (unchanged) {
      return state;
    }

    state = next;
    onChange(state);
    return state;
  };

  const computeRegion = (
    mode: CameraMode,
    selectedRiderId: string | null,
  ): MapRegion | null => {
    switch (mode) {
      case "FOLLOW_USER": {
        const current = getCurrentCoordinate();
        return current ? regionAround(current) : null;
      }
      case "FOLLOW_RIDE": {
        const current = getCurrentCoordinate();
        return regionContaining([
          ...(current ? [current] : []),
          ...getOtherCoordinates(),
        ]);
      }
      case "FOLLOW_SELECTED_RIDER": {
        const selected = selectedRiderId
          ? getRiderCoordinate(selectedRiderId)
          : null;
        return selected ? regionAround(selected) : null;
      }
      case "FREE":
      default:
        return null;
    }
  };

  const applyFollowRegion = (camera: MapCameraState): MapCameraState => {
    if (camera.mode === "FREE") {
      return camera;
    }

    const nextRegion =
      computeRegion(camera.mode, camera.selectedRiderId) ?? camera.region;

    if (sameRegion(nextRegion, camera.region)) {
      return camera;
    }

    return {
      ...camera,
      region: nextRegion,
      sequence: camera.sequence + 1,
    };
  };

  const setMode = (
    mode: CameraMode,
    setOptions: MapCameraSetModeOptions = {},
  ): MapCameraState => {
    const selectedRiderId =
      mode === "FOLLOW_SELECTED_RIDER"
        ? setOptions.selectedRiderId !== undefined
          ? setOptions.selectedRiderId
          : state.selectedRiderId
        : null;

    const candidate: MapCameraState = {
      ...state,
      mode,
      selectedRiderId,
      following: mode !== "FREE",
    };
    return commit(applyFollowRegion(candidate));
  };

  const refresh = (): MapCameraState => commit(applyFollowRegion(state));

  return {
    getState: () => state,
    setMode,
    notifyUserGesture(region) {
      // The native map echoes back every controller-commanded region. A
      // differing center means the user moved the camera; an identical center
      // is our own echo and must not exit follow mode, otherwise the camera
      // would ping-pong between the map and the controller.
      if (state.mode !== "FREE" && sameCoordinate(region, state.region)) {
        return state;
      }
      if (state.mode === "FREE" && sameRegion(region, state.region)) {
        return state;
      }
      return commit({
        ...state,
        mode: "FREE",
        selectedRiderId: null,
        region,
        following: false,
      });
    },
    refresh,
    handleRiderRemoved(riderId) {
      if (
        state.mode === "FOLLOW_SELECTED_RIDER" &&
        state.selectedRiderId === riderId
      ) {
        return setMode("FOLLOW_USER");
      }
      return refresh();
    },
    reset: () => setMode("FREE"),
    dispose() {
      disposed = true;
    },
  };
}
