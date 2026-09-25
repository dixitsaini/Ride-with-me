import {
  createMapCameraController,
  regionAround,
  regionContaining,
  type MapCameraState,
  type MapCoordinate,
  type MapRegion,
} from "./index";

const CURRENT: MapCoordinate = { latitude: 1, longitude: 1 };
const OTHER: MapCoordinate = { latitude: 3, longitude: 4 };

function contains(region: MapRegion, coordinate: MapCoordinate): boolean {
  return (
    Math.abs(coordinate.latitude - region.latitude) <=
      region.latitudeDelta / 2 + 1e-9 &&
    Math.abs(coordinate.longitude - region.longitude) <=
      region.longitudeDelta / 2 + 1e-9
  );
}

function setup() {
  let current: MapCoordinate | null = CURRENT;
  const riders = new Map<string, MapCoordinate>([["rider-b", OTHER]]);
  const changes: MapCameraState[] = [];

  const camera = createMapCameraController({
    getCurrentCoordinate: () => current,
    getRiderCoordinate: (riderId) => riders.get(riderId) ?? null,
    getOtherCoordinates: () => [...riders.values()],
    onChange: (next) => changes.push(next),
  });

  return {
    camera,
    changes,
    setCurrent: (coordinate: MapCoordinate | null) => {
      current = coordinate;
    },
    riders,
  };
}

describe("map camera modes", () => {
  it("starts in FREE with no controlled region", () => {
    const { camera } = setup();

    expect(camera.getState()).toEqual({
      mode: "FREE",
      selectedRiderId: null,
      region: null,
      sequence: 0,
      following: false,
    });
  });

  it("FOLLOW_USER tracks the current rider", () => {
    const { camera } = setup();

    camera.setMode("FOLLOW_USER");

    expect(camera.getState()).toMatchObject({
      mode: "FOLLOW_USER",
      following: true,
      region: { latitude: 1, longitude: 1 },
    });
  });

  it("FOLLOW_RIDE keeps every rider in view", () => {
    const { camera } = setup();

    camera.setMode("FOLLOW_RIDE");
    const region = camera.getState().region;

    expect(region).not.toBeNull();
    expect(contains(region as MapRegion, CURRENT)).toBe(true);
    expect(contains(region as MapRegion, OTHER)).toBe(true);
  });

  it("FOLLOW_SELECTED_RIDER tracks the selected rider", () => {
    const { camera } = setup();

    camera.setMode("FOLLOW_SELECTED_RIDER", { selectedRiderId: "rider-b" });

    expect(camera.getState()).toMatchObject({
      mode: "FOLLOW_SELECTED_RIDER",
      selectedRiderId: "rider-b",
      region: { latitude: 3, longitude: 4 },
    });
  });

  it("clears the selected rider when leaving FOLLOW_SELECTED_RIDER", () => {
    const { camera } = setup();
    camera.setMode("FOLLOW_SELECTED_RIDER", { selectedRiderId: "rider-b" });

    camera.setMode("FOLLOW_RIDE");

    expect(camera.getState().selectedRiderId).toBeNull();
  });

  it("emits a camera change for every mode transition", () => {
    const { camera, changes } = setup();

    camera.setMode("FOLLOW_USER");
    camera.setMode("FOLLOW_RIDE");
    camera.setMode("FOLLOW_SELECTED_RIDER", { selectedRiderId: "rider-b" });
    camera.reset();

    expect(changes.map((state) => state.mode)).toEqual([
      "FOLLOW_USER",
      "FOLLOW_RIDE",
      "FOLLOW_SELECTED_RIDER",
      "FREE",
    ]);
  });

  it("exits follow mode when the user moves the camera", () => {
    const { camera } = setup();
    camera.setMode("FOLLOW_USER");
    const sequenceBefore = camera.getState().sequence;

    camera.notifyUserGesture({
      latitude: 50,
      longitude: 60,
      latitudeDelta: 1,
      longitudeDelta: 1,
    });

    expect(camera.getState().mode).toBe("FREE");
    expect(camera.getState().following).toBe(false);
    expect(camera.getState().selectedRiderId).toBeNull();
    expect(camera.getState().region).toEqual({
      latitude: 50,
      longitude: 60,
      latitudeDelta: 1,
      longitudeDelta: 1,
    });
    expect(camera.getState().sequence).toBe(sequenceBefore);
  });

  it("ignores the echo of its own commanded region", () => {
    const { camera, changes } = setup();
    camera.setMode("FOLLOW_USER");
    const changesAfterMode = changes.length;

    camera.notifyUserGesture({
      latitude: 1,
      longitude: 1,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });

    expect(camera.getState().mode).toBe("FOLLOW_USER");
    expect(changes).toHaveLength(changesAfterMode);
  });

  it("does not emit when nothing actually changed", () => {
    const { camera, changes } = setup();
    camera.setMode("FOLLOW_USER");
    const changesAfterMode = changes.length;

    camera.refresh();
    camera.refresh();

    expect(changes).toHaveLength(changesAfterMode);
    expect(camera.getState().sequence).toBe(1);
  });

  it("falls back to FOLLOW_USER when the selected rider disappears", () => {
    const { camera, riders } = setup();
    camera.setMode("FOLLOW_SELECTED_RIDER", { selectedRiderId: "rider-b" });
    riders.delete("rider-b");

    camera.handleRiderRemoved("rider-b");

    expect(camera.getState().mode).toBe("FOLLOW_USER");
    expect(camera.getState().selectedRiderId).toBeNull();
    expect(camera.getState().region).toEqual(regionAround(CURRENT));
  });

  it("keeps the previous region while a follow mode has no target yet", () => {
    const { camera, setCurrent } = setup();
    setCurrent(null);

    camera.setMode("FOLLOW_USER");

    expect(camera.getState().region).toBeNull();

    setCurrent(CURRENT);
    camera.refresh();

    expect(camera.getState().region).toEqual(regionAround(CURRENT));
  });

  it("reset returns the camera to FREE", () => {
    const { camera } = setup();
    camera.setMode("FOLLOW_RIDE");

    camera.reset();

    expect(camera.getState()).toMatchObject({
      mode: "FREE",
      following: false,
      selectedRiderId: null,
    });
  });

  it("stops emitting after dispose", () => {
    const { camera, changes } = setup();
    camera.setMode("FOLLOW_USER");
    const changesAfterMode = changes.length;
    const stateBefore = camera.getState();

    camera.dispose();
    camera.setMode("FOLLOW_RIDE");
    camera.notifyUserGesture({
      latitude: 9,
      longitude: 9,
      latitudeDelta: 1,
      longitudeDelta: 1,
    });

    expect(changes).toHaveLength(changesAfterMode);
    expect(camera.getState()).toBe(stateBefore);
  });
});

describe("map camera regions", () => {
  it("builds a region around a single coordinate", () => {
    expect(regionAround({ latitude: 5, longitude: 6 })).toEqual({
      latitude: 5,
      longitude: 6,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  });

  it("returns no region for an empty coordinate set", () => {
    expect(regionContaining([])).toBeNull();
  });

  it("contains every coordinate it is given", () => {
    const region = regionContaining([
      { latitude: 1, longitude: 1 },
      { latitude: 3, longitude: 4 },
      { latitude: -2, longitude: 0 },
    ]);

    expect(region).not.toBeNull();
    expect(contains(region as MapRegion, { latitude: 3, longitude: 4 })).toBe(
      true,
    );
    expect(contains(region as MapRegion, { latitude: -2, longitude: 0 })).toBe(
      true,
    );
  });
});
