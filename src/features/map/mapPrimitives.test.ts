import {
  createMapController,
  createMockMapProvider,
  type MapController,
} from "./index";

const PATH = [
  { latitude: 1, longitude: 1 },
  { latitude: 2, longitude: 2 },
  { latitude: 3, longitude: 3 },
];

function createController(): MapController {
  const controller = createMapController({ provider: createMockMapProvider() });
  controller.initialize();
  return controller;
}

describe("map polylines", () => {
  it("preserves the coordinate ordering it was given", () => {
    const map = createController();

    map.upsertPolyline({ id: "path-a", coordinates: PATH });

    expect(map.getState().polylines[0]?.coordinates).toEqual(PATH);
    map.dispose();
  });

  it("adds, updates and removes a polyline", () => {
    const map = createController();

    map.upsertPolyline({ id: "path-a", coordinates: PATH });
    map.upsertPolyline({ id: "path-b", coordinates: [PATH[0]!] });
    expect(map.getState().polylines).toHaveLength(2);

    map.upsertPolyline({ id: "path-a", coordinates: [PATH[2]!] });
    expect(map.getState().polylines).toHaveLength(2);
    expect(
      map.getState().polylines.find((line) => line.id === "path-a")
        ?.coordinates,
    ).toEqual([PATH[2]]);
    expect(map.getState().polylines.map((line) => line.id)).toEqual([
      "path-a",
      "path-b",
    ]);

    map.removePolyline("path-a");
    expect(map.getState().polylines.map((line) => line.id)).toEqual(["path-b"]);

    map.removePolyline("path-a");
    expect(map.getState().polylines).toHaveLength(1);
    map.dispose();
  });

  it("keeps an empty path addressable instead of dropping it", () => {
    const map = createController();

    map.upsertPolyline({ id: "path-empty", coordinates: [] });

    expect(map.getState().polylines).toEqual([
      { id: "path-empty", coordinates: [] },
    ]);

    map.removePolyline("path-empty");
    expect(map.getState().polylines).toHaveLength(0);
    map.dispose();
  });

  it("clears every polyline at once", () => {
    const map = createController();
    map.upsertPolyline({ id: "path-a", coordinates: PATH });
    map.upsertPolyline({ id: "path-b", coordinates: PATH });

    map.clearPolylines();

    expect(map.getState().polylines).toHaveLength(0);
    map.dispose();
  });
});

describe("map annotations", () => {
  it("adds an annotation", () => {
    const map = createController();

    map.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 5, longitude: 6 },
      title: "Rest stop",
    });

    expect(map.getState().annotations).toEqual([
      {
        id: "pin-a",
        coordinate: { latitude: 5, longitude: 6 },
        title: "Rest stop",
      },
    ]);
    map.dispose();
  });

  it("updates an annotation in place", () => {
    const map = createController();
    map.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 1, longitude: 1 },
    });

    map.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 2, longitude: 2 },
      kind: "alert",
    });

    expect(map.getState().annotations).toHaveLength(1);
    expect(map.getState().annotations[0]).toEqual({
      id: "pin-a",
      coordinate: { latitude: 2, longitude: 2 },
      kind: "alert",
    });
    map.dispose();
  });

  it("removes an annotation", () => {
    const map = createController();
    map.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 1, longitude: 1 },
    });
    map.upsertAnnotation({
      id: "pin-b",
      coordinate: { latitude: 2, longitude: 2 },
    });

    map.removeAnnotation("pin-a");

    expect(map.getState().annotations.map((pin) => pin.id)).toEqual(["pin-b"]);
    map.dispose();
  });

  it("cleans up every annotation on clear and on dispose", () => {
    const map = createController();
    map.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 1, longitude: 1 },
    });

    map.clearAnnotations();
    expect(map.getState().annotations).toHaveLength(0);

    map.upsertAnnotation({
      id: "pin-b",
      coordinate: { latitude: 2, longitude: 2 },
    });
    map.dispose();
    expect(map.getState().annotations).toHaveLength(0);
  });
});
