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
  | { type: "ui:lock"; payload?: { reason?: UnlockReason } }
  | { type: "ui:resetAutoLockTimer" }
  | { type: "ui:switchAccount"; payload: { chainRef: string; address?: string | null } }
  | { type: "ui:switchChain"; payload: { chainRef: string } }
  | { type: "ui:approve"; payload: { id: string } }
  | { type: "ui:reject"; payload: { id: string; reason?: string } }
  | { type: "ui:setAutoLockDuration"; payload: { durationMs: number } };

/**
 * Error structure for UI responses
 */
export type UiError = {
  message: string;
  code?: number;
  data?: unknown;
};

/**
 * Envelope types for port message protocol
 */
export type UiPortEnvelope =
  | { type: "ui:request"; requestId: string; payload: UiMessage }
  | { type: "ui:response"; requestId: string; result: unknown }
  | { type: "ui:error"; requestId: string; error: UiError }
  | { type: "ui:event"; event: "ui:stateChanged"; payload: UiSnapshot };
