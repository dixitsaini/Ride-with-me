import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/AppThemeProvider";

export function HomeScreen() {
  const theme = useAppTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Rider App
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
        Phase 0 foundation initialized.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
  },
});
