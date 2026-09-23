export const theme = {
  colors: {
    background: "#F7F8FA",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF2F6",
    primary: "#1F6FEB",
    primarySoft: "#EAF2FF",
    text: "#101828",
    textMuted: "#475467",
    success: "#16A34A",
    warning: "#F59E0B",
    danger: "#DC2626",
    border: "#D0D5DD",
    overlay: "rgba(16, 24, 40, 0.32)",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
  },
  typography: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 28,
  },
} as const;

export type AppTheme = typeof theme;
