import { z } from "zod";
import { defineMethod } from "./types.js";

const OpenOnboardingTabResultSchema = z.strictObject({
  activationPath: z.enum(["focus", "create", "debounced"]),
  tabId: z.number().int().optional(),
});

export const onboardingMethods = {
  "ui.onboarding.openTab": defineMethod(z.strictObject({ reason: z.string().min(1) }), OpenOnboardingTabResultSchema),
} as const;
