import type { UiErrorPayload } from "@arx/errors";
import type { UnlockReason } from "../controllers/index.js";
import type { UiSnapshot } from "./schemas.js";

/**
 * UI channel name for port-based communication
 */
export const UI_CHANNEL = "arx:ui" as const;

/**
 * UI request message types sent from popup to background
 */
export type UiMessage =
  | { type: "ui:getSnapshot" }
  | { type: "ui:vaultInit"; payload: { password: string } }
  | { type: "ui:unlock"; payload: { password: string } }
  | { type: "ui:openOnboardingTab"; payload: { reason: string } }
  | { type: "ui:lock"; payload?: { reason?: UnlockReason } }
  | { type: "ui:resetAutoLockTimer" }
  | { type: "ui:switchAccount"; payload: { chainRef: string; address?: string | null } }
  | { type: "ui:switchChain"; payload: { chainRef: string } }
  | { type: "ui:approve"; payload: { id: string } }
  | { type: "ui:reject"; payload: { id: string; reason?: string } }
  | { type: "ui:setAutoLockDuration"; payload: { durationMs: number } }
  | { type: "ui:generateMnemonic"; payload?: { wordCount?: 12 | 24 } }
  | {
      type: "ui:confirmNewMnemonic";
      payload: { words: string[]; alias?: string; skipBackup?: boolean; namespace?: string };
    }
  | { type: "ui:importMnemonic"; payload: { words: string[]; alias?: string; namespace?: string } }
  | { type: "ui:importPrivateKey"; payload: { privateKey: string; alias?: string; namespace?: string } }
  | { type: "ui:deriveAccount"; payload: { keyringId: string } }
  | { type: "ui:getKeyrings" }
  | { type: "ui:getAccountsByKeyring"; payload: { keyringId: string; includeHidden?: boolean } }
  | { type: "ui:renameKeyring"; payload: { keyringId: string; alias: string } }
  | { type: "ui:renameAccount"; payload: { address: string; alias: string } }
  | { type: "ui:markBackedUp"; payload: { keyringId: string } }
  | { type: "ui:hideHdAccount"; payload: { address: string } }
  | { type: "ui:unhideHdAccount"; payload: { address: string } }
  | { type: "ui:removePrivateKeyKeyring"; payload: { keyringId: string } }
  | { type: "ui:exportMnemonic"; payload: { keyringId: string; password: string } }
  | { type: "ui:exportPrivateKey"; payload: { address: string; password: string } };

/**
 * Error structure for UI responses
 */
export type UiError = {
  reason: UiErrorPayload["reason"];
  message: UiErrorPayload["message"];
  data?: UiErrorPayload["data"];
};

/**
 * Envelope types for port message protocol
 */
type UiPortEvent =
  | { event: "ui:stateChanged"; payload: UiSnapshot }
  | { event: "ui:approvalsChanged"; payload: UiSnapshot["approvals"] }
  | { event: "ui:unlocked"; payload: { at: number } };

/**
 * Envelope types for port message protocol
 */
export type UiPortEnvelope =
  | { type: "ui:request"; requestId: string; payload: UiMessage }
  | { type: "ui:response"; requestId: string; result: unknown }
  | { type: "ui:error"; requestId: string; error: UiError }
  | ({ type: "ui:event" } & UiPortEvent);
