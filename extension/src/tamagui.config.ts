import { config as defaultConfig } from "@tamagui/config";
import { createTamagui } from "tamagui";

// Use Tamagui's default configuration, only keeping light/dark themes
const config = createTamagui({
  ...defaultConfig,
  themes: {
    light: defaultConfig.themes.light,
    dark: defaultConfig.themes.dark,
  },
});

export type AppConfig = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
