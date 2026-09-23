import {
  createMockLocationService,
  createLocationController,
  createLocationSample,
} from "./index";

describe("LocationController", () => {
  it("tracks permission and start/stop lifecycle", async () => {
    const service = createMockLocationService();
    const controller = createLocationController(service);

    await controller.requestPermission();
    await controller.startTracking();

    expect(controller.getStatus().permission).toBe("GRANTED");
    expect(controller.getStatus().tracking).toBe("TRACKING");

    await controller.stopTracking();
    expect(controller.getStatus().tracking).toBe("READY");
  });

  it("propagates status and location updates to subscribers", async () => {
    const service = createMockLocationService();
    const controller = createLocationController(service);
    const onLocation = jest.fn();
    const onStatus = jest.fn();

    controller.subscribeToLocationChanges(onLocation);
    controller.subscribeToStatusChanges(onStatus);
    await controller.startTracking();

    const sample = createLocationSample({
      latitude: 11.1,
      longitude: 22.2,
      timestamp: Date.now(),
      accuracy: 9,
    });

    service.publish(sample);

    expect(onLocation).toHaveBeenCalledWith(sample);
    expect(onStatus).toHaveBeenCalled();
  });
});
