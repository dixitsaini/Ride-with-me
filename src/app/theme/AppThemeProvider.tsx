import React, { createContext, useContext } from "react";
import { theme } from "./theme";

const AppThemeContext = createContext(theme);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppThemeContext.Provider value={theme}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}
