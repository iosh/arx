import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiOnboardingOpenTabParamsSchema = z.strictObject({ reason: z.string().min(1) });

export const onboardingMethods = {
  // Host activation method; intentionally protocol-local, not part of core.wallet.
  "ui.onboarding.openTab": defineMethod("command", UiOnboardingOpenTabParamsSchema),

  "ui.onboarding.generateMnemonic": defineMethod("command", WalletApiSchemas.setup.generateMnemonic),

  "ui.onboarding.createWalletFromMnemonic": defineMethod("command", WalletApiSchemas.setup.createWalletFromMnemonic),

  "ui.onboarding.importWalletFromMnemonic": defineMethod("command", WalletApiSchemas.setup.importWalletFromMnemonic),

  "ui.onboarding.importWalletFromPrivateKey": defineMethod(
    "command",
    WalletApiSchemas.setup.importWalletFromPrivateKey,
  ),
} as const;
