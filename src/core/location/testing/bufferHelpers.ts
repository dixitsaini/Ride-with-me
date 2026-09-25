import type {
  LocationBufferStorage,
  LocationBufferSnapshot,
} from "../persistentBuffer";
import { createMemoryLocationBufferStorage } from "../persistentBuffer";

export function createSharedLocationStorage(): LocationBufferStorage {
  return createMemoryLocationBufferStorage();
}

export function snapshotOf(buffer: {
  snapshot: () => LocationBufferSnapshot;
}): LocationBufferSnapshot {
  return buffer.snapshot();
}
