import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import type {
  MapRegion,
  MapRenderState,
  RiderMarker,
  RiderMarkerState,
} from "./types";

type ReactNativeMapSurfaceProps = {
  state: MapRenderState;
  onUserCameraGesture?: (region: MapRegion) => void;
  style?: StyleProp<ViewStyle>;
  showsUserLocation?: boolean;
};

const FALLBACK_REGION: Region = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

/**
 * Visual separation of marker semantics. The contract only carries
 * `RiderMarkerState`; the concrete styling stays inside the provider.
 */
const MARKER_OPACITY: Record<RiderMarkerState, number> = {
  LIVE: 1,
  STALE: 0.55,
  UNAVAILABLE: 0.35,
};

function riderDescription(marker: RiderMarker): string {
  return marker.state;
}

export function ReactNativeMapSurface({
  state,
  onUserCameraGesture,
  style,
  showsUserLocation = true,
}: ReactNativeMapSurfaceProps) {
  const region = (state.camera.region ?? FALLBACK_REGION) as Region;

  return (
    <MapView
      style={[styles.map, style]}
      region={region}
      showsUserLocation={showsUserLocation}
      onRegionChangeComplete={(nextRegion) =>
        onUserCameraGesture?.(nextRegion as MapRegion)
      }
    >
      {state.currentRider?.coordinate ? (
        <Marker
          key={`current-${state.currentRider.riderId}`}
          coordinate={state.currentRider.coordinate}
          title={state.currentRider.label}
          description={riderDescription(state.currentRider)}
          opacity={MARKER_OPACITY[state.currentRider.state]}
          tracksViewChanges={false}
        />
      ) : null}
      {state.riders.map((marker) =>
        marker.coordinate ? (
          <Marker
            key={marker.riderId}
            coordinate={marker.coordinate}
            title={marker.label}
            description={riderDescription(marker)}
            opacity={MARKER_OPACITY[marker.state]}
            tracksViewChanges={false}
          />
        ) : null,
      )}
      {state.polylines.map((polyline) => (
        <Polyline key={polyline.id} coordinates={polyline.coordinates} />
      ))}
      {state.annotations.map((annotation) => (
        <Marker
          key={`annotation-${annotation.id}`}
          coordinate={annotation.coordinate}
          title={annotation.title}
          description={annotation.subtitle}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
