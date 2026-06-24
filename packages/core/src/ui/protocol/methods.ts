import { entryMethods } from "./methods/entry.js";
import { onboardingMethods } from "./methods/onboarding.js";
import type { UiMethodDefinition } from "./methods/types.js";

export const uiMethods = {
  // --- entry ---
  ...entryMethods,

  // --- host activation ---
  ...onboardingMethods,
} as const satisfies Record<string, UiMethodDefinition>;
