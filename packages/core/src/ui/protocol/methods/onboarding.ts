import { z } from "zod";
import { defineMethod } from "./types.js";

const UiOnboardingOpenTabParamsSchema = z.strictObject({ reason: z.string().min(1) });

export const onboardingMethods = {
  // Host activation method; intentionally protocol-local, not part of core.wallet.
  "ui.onboarding.openTab": defineMethod("command", UiOnboardingOpenTabParamsSchema),
} as const;
