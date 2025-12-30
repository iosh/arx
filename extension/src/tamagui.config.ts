import { config as defaultConfig } from "@tamagui/config";
import { createTamagui } from "tamagui";

// Use Tamagui's default configuration, only keeping light/dark themes
const config = createTamagui({
  ...defaultConfig,
  tokens: {
    ...defaultConfig.tokens,
    space: {
      ...defaultConfig.tokens.space,
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      7: 32,
      8: 40,
    },
    radius: {
      ...defaultConfig.tokens.radius,
      sm: 8,
      md: 12,
      lg: 16,
    },
    zIndex: {
      ...defaultConfig.tokens.zIndex,
      base: 0,
      header: 10,
      footer: 10,
      sheet: 100,
      overlay: 200,
      toast: 300,
    },
    // Motion/animation durations (in ms)
    // Usage: transition: `all ${tokens.animation.base}ms ease`
    animation: {
      fast: 120, // hover/press/small feedback
      base: 180, // normal transitions
      slow: 240, // panel enter/exit
      sheet: 220, // sheet open/close
      toast: 160, // toast enter/exit
    },
  },
  themes: {
    light: {
      ...defaultConfig.themes.light,
      bg: "#FFFFFF",
      surface: "#F3F4F6",
      cardBg: "#FFFFFF",
      text: "#000000",
      mutedText: "#666666",
      border: "#E5E5E5",

      accent: "#171717",
      accentHover: "#404040",
      accentPress: "#000000",
      accentText: "#FFFFFF",
      accentHoverText: "#FFFFFF",
      accentPressText: "#FFFFFF",

      danger: "#E11D48",
      dangerHover: "#BE123C",
      dangerPress: "#9F1239",
      dangerText: "#FFFFFF",
      dangerHoverText: "#FFFFFF",
      dangerPressText: "#FFFFFF",
      success: "#059669",
      background: "#FFFFFF",
      color: "#000000",
      borderColor: "#E5E5E5",
    },
    dark: {
      ...defaultConfig.themes.dark,
      bg: "#000000",
      surface: "#121212",
      cardBg: "#1C1C1C",
      text: "#FFFFFF",
      mutedText: "#888888",
      border: "#333333",

      accent: "#FFFFFF",
      accentHover: "#D4D4D4",
      accentPress: "#A3A3A3",
      accentText: "#000000",
      accentHoverText: "#000000",
      accentPressText: "#000000",

      danger: "#FB7185",
      dangerHover: "#FDA4AF",
      dangerPress: "#F43F5E",
      dangerText: "#000000",
      dangerHoverText: "#000000",
      dangerPressText: "#000000",
      success: "#34D399",
      background: "#000000",
      color: "#FFFFFF",
      borderColor: "#333333",
    },
  },
});

export type AppConfig = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
