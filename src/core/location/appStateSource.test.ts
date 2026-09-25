import {
  createInMemoryAppStateSource,
  createReactNativeAppStateSource,
  normalizeAppState,
} from "./appStateSource";

describe("normalizeAppState", () => {
  it.each([
    ["active", "foreground"],
    ["background", "background"],
    ["inactive", "inactive"],
    ["unknown", "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["something-else", "unknown"],
  ] as const)("maps %p to %s", (input, expected) => {
    expect(normalizeAppState(input)).toBe(expected);
  });

  it("keeps an already normalized value", () => {
    expect(normalizeAppState("foreground")).toBe("unknown");
  });
});

describe("in-memory app state source", () => {
  it("starts from the given state and notifies subscribers", () => {
    const source = createInMemoryAppStateSource("background");
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);

    expect(source.getState()).toBe("background");
    source.setState("foreground");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("foreground");

    source.setState("foreground");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    source.setState("background");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.getState()).toBe("background");
  });

  it("defaults to foreground", () => {
    expect(createInMemoryAppStateSource().getState()).toBe("foreground");
  });
});

describe("react-native app state source", () => {
  it("subscribes through AppState and normalizes the value", () => {
    const source = createReactNativeAppStateSource();
    expect(["foreground", "background", "inactive", "unknown"]).toContain(
      source.getState(),
    );
    expect(typeof source.subscribe).toBe("function");
  });
});
