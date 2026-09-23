import React, { useEffect, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../app/navigation";
import {
  ReactNativeMapSurface,
  type MapRider,
} from "../map/ReactNativeMapSurface";
import { developmentRidingService } from "./development";
import type { Ride } from "./domain";

type Props = NativeStackScreenProps<RootStackParamList, "LiveGroupMap">;

export function LiveGroupMapScreen({ route, navigation }: Props) {
  const [ride, setRide] = useState<Ride | null>(null);
  const [riders, setRiders] = useState<Map<string, MapRider>>(new Map());
  const [status, setStatus] = useState("CONNECTING");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const nextRide = await developmentRidingService.getRide(
          route.params.rideId,
        );
        if (!nextRide) {
          throw new Error("Ride was not found.");
        }
        setRide(nextRide);
        setStatus(developmentRidingService.getLocationConnectionState());
        stop = await developmentRidingService.subscribeRideLocations(
          nextRide.id,
          (update) => {
            if (!active) return;
            setStatus(update.stale ? "STALE" : "CONNECTED");
            setRiders((current) => new Map(current).set(update.userId, update));
          },
        );
        await developmentRidingService.publishCurrentLocation(nextRide.id);
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load live ride.",
          );
      }
    })();
    return () => {
      active = false;
      stop?.();
    };
  }, [route.params.rideId]);

  const completeRide = async () => {
    try {
      await developmentRidingService.updateRideState(
        route.params.rideId,
        "COMPLETED",
      );
      navigation.navigate("Groups");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to complete ride.",
      );
    }
  };

  const changeRideState = async (nextState: "ACTIVE" | "PAUSED") => {
    try {
      const updated = await developmentRidingService.updateRideState(
        route.params.rideId,
        nextState,
      );
      setRide(updated);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update ride.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Live Group Map</Text>
          <Text style={styles.muted}>
            {ride?.state ?? "LOADING"} · {status}
          </Text>
        </View>
        <View>
          {ride?.state === "ACTIVE" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void changeRideState("PAUSED")}
              style={styles.pauseButton}
            >
              <Text style={styles.completeText}>Pause</Text>
            </Pressable>
          ) : null}
          {ride?.state === "PAUSED" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void changeRideState("ACTIVE")}
              style={styles.pauseButton}
            >
              <Text style={styles.completeText}>Resume</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => void completeRide()}
            style={styles.completeButton}
          >
            <Text style={styles.completeText}>End ride</Text>
          </Pressable>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ReactNativeMapSurface riders={[...riders.values()]} />
      <View style={styles.riderList}>
        {[...riders.values()].map((rider) => (
          <Text key={rider.userId} style={styles.riderText}>
            {rider.userId}: {rider.stale ? "STALE" : "LIVE"}
          </Text>
        ))}
        {riders.size === 0 ? (
          <Text style={styles.muted}>No participant updates yet.</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FA" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  title: { color: "#101828", fontSize: 22, fontWeight: "700" },
  muted: { color: "#475467", marginTop: 4 },
  completeButton: { backgroundColor: "#DC2626", borderRadius: 8, padding: 10 },
  pauseButton: {
    backgroundColor: "#F59E0B",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  completeText: { color: "#FFFFFF", fontWeight: "700" },
  error: { color: "#DC2626", paddingHorizontal: 16, paddingBottom: 8 },
  riderList: { padding: 16 },
  riderText: { color: "#101828", fontSize: 15, paddingVertical: 4 },
});
