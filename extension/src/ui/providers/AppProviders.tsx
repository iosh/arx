import type { ReactNode } from "react";
import { TamaguiProvider, Theme, YStack } from "tamagui";
import config from "@/tamagui.config";
import { useThemeMode } from "@/ui/lib/themeMode";
import { ToastHost } from "../components";

function getSystemThemeName(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function AppProviders({ children }: { children: ReactNode }) {
  const { themeMode } = useThemeMode();
  const themeName = themeMode === "system" ? getSystemThemeName() : themeMode;

  return (
    <TamaguiProvider config={config} defaultTheme={themeName}>
      <Theme name={themeName}>
        <YStack flex={1} position="relative">
          {children}
          <ToastHost />
        </YStack>
      </Theme>
    </TamaguiProvider>
  );
}
