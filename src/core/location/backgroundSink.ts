import type { LocationSample } from "./index";

/**
 * A sink receives normalized samples produced by the OS background location
 * task. Exactly one LocationEngine is expected to register itself while a
 * tracking session owns the background stream; the registry is a set so a
 * repeated registration can never create a second pipeline.
 */
export type BackgroundLocationSink = (sample: LocationSample) => void;

const sinks = new Set<BackgroundLocationSink>();

export function addBackgroundLocationSink(
  sink: BackgroundLocationSink,
): () => void {
  sinks.add(sink);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    sinks.delete(sink);
  };
}

export function pushBackgroundLocation(sample: LocationSample): number {
  if (sinks.size === 0) {
    return 0;
  }
  sinks.forEach((sink) => {
    sink(sample);
  });
  return sinks.size;
}

export function getBackgroundLocationSinkCount(): number {
  return sinks.size;
}

export function clearBackgroundLocationSinks(): void {
  sinks.clear();
}
