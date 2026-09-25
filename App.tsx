// Must run before any ride starts: the OS needs the background location task
// defined while the entry module is still evaluating.
import "./src/core/location/background";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AppThemeProvider } from "./src/app/theme/AppThemeProvider";
import type { RootStackParamList } from "./src/app/navigation";
import {
  CreateGroupScreen,
  GroupDetailsScreen,
  GroupsScreen,
  JoinGroupScreen,
  MembersScreen,
} from "./src/features/riding/GroupScreens";
import { LiveGroupMapScreen } from "./src/features/riding/LiveGroupMapScreen";

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <RootStack.Navigator initialRouteName="Groups">
            <RootStack.Screen
              name="Groups"
              component={GroupsScreen}
              options={{ title: "Groups" }}
            />
            <RootStack.Screen
              name="CreateGroup"
              component={CreateGroupScreen}
              options={{ title: "Create Group" }}
            />
            <RootStack.Screen
              name="JoinGroup"
              component={JoinGroupScreen}
              options={{ title: "Join Group" }}
            />
            <RootStack.Screen
              name="GroupDetails"
              component={GroupDetailsScreen}
              options={{ title: "Group" }}
            />
            <RootStack.Screen
              name="Members"
              component={MembersScreen}
              options={{ title: "Members" }}
            />
            <RootStack.Screen
              name="LiveGroupMap"
              component={LiveGroupMapScreen}
              options={{ title: "Live Group Map" }}
            />
          </RootStack.Navigator>
        </NavigationContainer>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
