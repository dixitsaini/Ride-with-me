import React, { useEffect, useSyncExternalStore } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { MapController } from "./MapController";
import { ReactNativeMapSurface } from "./ReactNativeMapSurface";
import type { MapConnectionState, MapRegion } from "./types";

type MapSurfaceProps = {
  map: MapController;
  style?: StyleProp<ViewStyle>;
  emptyMessage?: string;
};

const CONNECTION_LABEL: Record<MapConnectionState, string> = {
  DISCONNECTED: "Offline",
  CONNECTING: "Connecting",
  CONNECTED: "Connected",
  RECONNECTING: "Reconnecting",
  STALE: "Live updates delayed",
  ERROR: "Connection problem",
};

/**
 * Screen-facing surface: binds the authoritative map state to the configured
 * `MapProvider` implementation and renders the map chrome around it.
 *
 * The surface never acquires location and never subscribes to realtime - the
 * `MapController` it is handed is fed by the owning screen.
 */
export function MapSurface({
  map,
  style,
  emptyMessage = "Waiting for rider locations",
}: MapSurfaceProps) {
  useEffect(() => {
    map.initialize();
  }, [map]);

  const state = useSyncExternalStore(
    (onChange) => map.subscribe(onChange),
    () => map.getState(),
  );

  const handleUserCameraGesture = (region: MapRegion) => {
    map.notifyUserCameraGesture(region);
  };

  const hasRiders = state.currentRider !== null || state.riders.length > 0;

  return (
    <View style={[styles.container, style]}>
      <ReactNativeMapSurface
        state={state}
        onUserCameraGesture={handleUserCameraGesture}
      />
      {state.connection !== "CONNECTED" ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>
            {CONNECTION_LABEL[state.connection]}
          </Text>
        </View>
      ) : null}
      {!hasRiders ? (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
  statusBanner: {
    position: "absolute",
    top: 16,
    right: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(16,24,40,0.86)",
    borderRadius: 999,
  },
  statusText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  emptyOverlay: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 8,
  },
  emptyText: { color: "#101828", fontSize: 14 },
});
