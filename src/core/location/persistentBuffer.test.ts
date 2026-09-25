import {
  createMemoryLocationBufferStorage,
  createPersistentLocationBuffer,
} from "./persistentBuffer";
import type { LocationSample } from "./index";

function sample(timestamp: number, overrides: Partial<LocationSample> = {}) {
  return {
    latitude: 40 + timestamp / 1_000_000,
    longitude: -74,
    timestamp,
    accuracy: 8,
    ...overrides,
  } satisfies LocationSample;
}

const base = 1_700_000_000_000;

describe("persistent location buffer", () => {
  it("appends in order and rejects out-of-order appends", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
    });
    await buffer.load();

    await buffer.append(sample(base + 1_000), true);
    await buffer.append(sample(base + 3_000), true);
    await buffer.append(sample(base + 2_000), true);

    expect(buffer.pending().map((entry) => entry.timestamp)).toEqual([
      base + 1_000,
      base + 3_000,
    ]);
    expect(buffer.state()).toBe("PENDING");
  });

  it("drops duplicate and out-of-order appends", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
    });
    await buffer.load();

    expect(await buffer.append(sample(base), true)).not.toBeNull();
    expect(await buffer.append(sample(base), true)).toBeNull();
    expect(await buffer.append(sample(base - 1_000), true)).toBeNull();

    expect(buffer.pendingCount()).toBe(1);
  });

  it("persists and recovers pending samples across instances", async () => {
    const storage = createMemoryLocationBufferStorage();
    const first = createPersistentLocationBuffer({ storage, now: () => base });
    await first.load();
    await first.append(sample(base + 1_000), true);
    await first.append(sample(base + 2_000), true);

    const second = createPersistentLocationBuffer({ storage, now: () => base });
    await second.load();

    expect(second.pendingCount()).toBe(2);
    expect(second.pending().map((entry) => entry.timestamp)).toEqual([
      base + 1_000,
      base + 2_000,
    ]);
    expect(second.state()).toBe("PENDING");
  });

  it("removes successfully synchronized samples", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
    });
    await buffer.load();
    const entry = await buffer.append(sample(base), true);

    await buffer.markSynced(entry!.id);

    expect(buffer.pendingCount()).toBe(0);
    expect(buffer.state()).toBe("EMPTY");
    expect(buffer.snapshot().lastSyncedAt).toBe(base);
  });

  it("retains failed samples for retry with attempt bookkeeping", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
    });
    await buffer.load();
    const entry = await buffer.append(sample(base), true);

    await buffer.markFailed(entry!.id, "network unavailable");
    await buffer.markFailed(entry!.id, "network unavailable");

    expect(buffer.pendingCount()).toBe(1);
    expect(buffer.pending()[0].attempts).toBe(2);
    expect(buffer.pending()[0].lastError).toBe("network unavailable");
    expect(buffer.snapshot().state).toBe("PENDING");
  });

  it("marks non-publishable entries for reconciliation", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
    });
    await buffer.load();
    const kept = await buffer.append(sample(base), true);
    const dropped = await buffer.append(sample(base + 1_000), false);

    await buffer.markReconciled(dropped!.id);

    expect(buffer.pending().map((entry) => entry.id)).toEqual([kept!.id]);
    expect(buffer.snapshot().lastReconciledAt).toBe(base);
  });

  it("applies the retention policy without losing the newest samples", async () => {
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => base,
      retention: { maxSamples: 2 },
    });
    await buffer.load();

    await buffer.append(sample(base + 1_000), true);
    await buffer.append(sample(base + 2_000), true);
    await buffer.append(sample(base + 3_000), true);

    expect(buffer.pending().map((entry) => entry.timestamp)).toEqual([
      base + 2_000,
      base + 3_000,
    ]);
    expect(buffer.snapshot().dropped).toBe(1);
  });

  it("drops samples older than the retention window", async () => {
    let clock = base;
    const buffer = createPersistentLocationBuffer({
      storage: createMemoryLocationBufferStorage(),
      now: () => clock,
      retention: { maxAgeMs: 10_000 },
    });
    await buffer.load();

    await buffer.append(sample(base + 1_000), true);
    clock = base + 60_000;
    await buffer.append(sample(clock), true);

    expect(buffer.pending().map((entry) => entry.timestamp)).toEqual([clock]);
  });

  it("clears the buffer and the persisted payload", async () => {
    const storage = createMemoryLocationBufferStorage();
    const buffer = createPersistentLocationBuffer({ storage, now: () => base });
    await buffer.load();
    await buffer.append(sample(base), true);

    await buffer.clear();

    expect(buffer.pendingCount()).toBe(0);
    expect(await storage.getItem("location.buffer.v1")).toBeNull();
  });

  it("recovers from an unreadable persisted payload", async () => {
    const storage = createMemoryLocationBufferStorage();
    await storage.setItem("location.buffer.v1", "{not-json");

    const buffer = createPersistentLocationBuffer({ storage, now: () => base });
    await buffer.load();

    expect(buffer.pendingCount()).toBe(0);
    expect(await buffer.append(sample(base), true)).not.toBeNull();
  });
});
