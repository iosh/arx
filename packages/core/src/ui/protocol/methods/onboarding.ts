import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiOnboardingOpenTabParamsSchema = z.strictObject({ reason: z.string().min(1) });

export const onboardingMethods = {
  // Host activation method; intentionally protocol-local, not part of core.wallet.
  "ui.onboarding.openTab": defineMethod("command", UiOnboardingOpenTabParamsSchema),

  "ui.onboarding.getStatus": defineMethod("query", WalletApiSchemas.onboarding.getStatus),

  "ui.onboarding.generateMnemonic": defineMethod("command", WalletApiSchemas.onboarding.generateMnemonic),

  "ui.onboarding.createWalletFromMnemonic": defineMethod(
    "command",
    WalletApiSchemas.onboarding.createWalletFromMnemonic,
  ),

  "ui.onboarding.importWalletFromMnemonic": defineMethod(
    "command",
    WalletApiSchemas.onboarding.importWalletFromMnemonic,
  ),

  "ui.onboarding.importWalletFromPrivateKey": defineMethod(
    "command",
    WalletApiSchemas.onboarding.importWalletFromPrivateKey,
  ),
} as const;
