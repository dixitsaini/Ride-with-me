import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../app/navigation";
import type { Group, GroupInvitation, GroupMember } from "./domain";
import { developmentRidingService } from "./development";

type GroupsProps = NativeStackScreenProps<RootStackParamList, "Groups">;
type CreateGroupProps = NativeStackScreenProps<
  RootStackParamList,
  "CreateGroup"
>;
type JoinGroupProps = NativeStackScreenProps<RootStackParamList, "JoinGroup">;
type GroupDetailsProps = NativeStackScreenProps<
  RootStackParamList,
  "GroupDetails"
>;
type MembersProps = NativeStackScreenProps<RootStackParamList, "Members">;

function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function GroupsScreen({ navigation }: GroupsProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await developmentRidingService.listGroups());
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load groups.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Groups</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Create group"
          onPress={() => navigation.navigate("CreateGroup")}
        />
        <ActionButton
          label="Join group"
          onPress={() => navigation.navigate("JoinGroup")}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={groups}
        keyExtractor={(group) => group.id}
        ListEmptyComponent={<Text style={styles.muted}>No groups yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate("GroupDetails", { groupId: item.id })
            }
            style={styles.row}
          >
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.muted}>{item.state}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

export function CreateGroupScreen({ navigation }: CreateGroupProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    try {
      const group = await developmentRidingService.createGroup(name);
      navigation.replace("GroupDetails", { groupId: group.id });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create group.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Create Group</Text>
      <TextInput
        placeholder="Group name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ActionButton label="Create" onPress={() => void create()} />
    </SafeAreaView>
  );
}

export function JoinGroupScreen({ navigation }: JoinGroupProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    try {
      const group = await developmentRidingService.joinGroup(code);
      navigation.replace("GroupDetails", { groupId: group.id });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to join group.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Join Group</Text>
      <TextInput
        placeholder="Invite code"
        value={code}
        onChangeText={setCode}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ActionButton label="Join" onPress={() => void join()} />
    </SafeAreaView>
  );
}

export function GroupDetailsScreen({ route, navigation }: GroupDetailsProps) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invitation, setInvitation] = useState<GroupInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextGroup, nextMembers] = await Promise.all([
      developmentRidingService.getGroup(route.params.groupId),
      developmentRidingService.listMembers(route.params.groupId),
    ]);
    setGroup(nextGroup);
    setMembers(nextMembers);
  }, [route.params.groupId]);

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : "Unable to load group.",
      ),
    );
  }, [refresh]);

  if (!group) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.muted}>Loading group...</Text>
      </SafeAreaView>
    );
  }

  const invite = async () => {
    try {
      setInvitation(await developmentRidingService.createInvitation(group.id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create invitation.",
      );
    }
  };

  const startRide = async () => {
    try {
      const ride = await developmentRidingService.startRide(group.id);
      navigation.navigate("LiveGroupMap", { rideId: ride.id });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to start ride.",
      );
    }
  };

  const archive = async () => {
    try {
      await developmentRidingService.archiveGroup(group.id);
      navigation.navigate("Groups");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to archive group.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>{group.name}</Text>
      <Text style={styles.muted}>
        {members.filter((member) => member.status === "ACTIVE").length} members
      </Text>
      {invitation ? (
        <Text style={styles.invite}>Invite code: {invitation.code}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ActionButton label="Create invite" onPress={() => void invite()} />
      <ActionButton
        label="Members"
        onPress={() => navigation.navigate("Members", { groupId: group.id })}
      />
      <ActionButton label="Start ride" onPress={() => void startRide()} />
      <ActionButton label="Archive group" onPress={() => void archive()} />
      <ActionButton label="Refresh" onPress={() => void refresh()} />
    </SafeAreaView>
  );
}

export function MembersScreen({ route }: MembersProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  useEffect(() => {
    void developmentRidingService
      .listMembers(route.params.groupId)
      .then(setMembers);
  }, [route.params.groupId]);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Members</Text>
      {members.map((member) => (
        <View key={member.userId} style={styles.row}>
          <Text style={styles.rowTitle}>{member.userId}</Text>
          <Text style={styles.muted}>
            {member.role} · {member.status}
          </Text>
        </View>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: "#F7F8FA" },
  title: {
    color: "#101828",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  actions: { flexDirection: "row", gap: 8, marginBottom: 16 },
  button: {
    backgroundColor: "#1F6FEB",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D0D5DD",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  row: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D0D5DD",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  rowTitle: { color: "#101828", fontSize: 17, fontWeight: "600" },
  muted: { color: "#475467", fontSize: 14, marginTop: 4 },
  error: { color: "#DC2626", marginBottom: 10 },
  invite: { color: "#166534", fontWeight: "600", marginBottom: 10 },
});
