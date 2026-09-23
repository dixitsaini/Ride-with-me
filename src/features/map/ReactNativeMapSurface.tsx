import React from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import type { LocationSample } from "../../core/location";

export type MapRider = {
  userId: string;
  location: LocationSample;
  stale: boolean;
};

type ReactNativeMapSurfaceProps = {
  riders: MapRider[];
};

const defaultRegion: Region = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export function ReactNativeMapSurface({ riders }: ReactNativeMapSurfaceProps) {
  const region = riders[0]
    ? {
        latitude: riders[0].location.latitude,
        longitude: riders[0].location.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    : defaultRegion;

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={region} showsUserLocation>
        {riders.map((rider) => (
          <Marker
            key={rider.userId}
            coordinate={{
              latitude: rider.location.latitude,
              longitude: rider.location.longitude,
            }}
            title={rider.userId}
            description={rider.stale ? "STALE" : "LIVE"}
          />
        ))}
      </MapView>
      {riders.length === 0 ? (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>Waiting for rider locations</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
  map: { flex: 1 },
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
