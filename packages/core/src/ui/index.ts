export { uiActions } from "./actions.js";
export type { UiClient, UiClientOptions, UiProtocolError, UiRemoteError, UiTransport } from "./client/index.js";
export { createUiClient } from "./client/index.js";
export { UI_EVENT_SNAPSHOT_CHANGED, uiEvents } from "./events.js";
export type {
  UiContext,
  UiError,
  UiErrorEnvelope,
  UiEventEnvelope,
  UiPortEnvelope,
  UiRequestEnvelope,
  UiResponseEnvelope,
} from "./messages.js";
export { parseUiEnvelope, UI_CHANNEL } from "./messages.js";
export { uiMethods } from "./methods.js";

export {
  isUiEventName,
  isUiMethodName,
  parseUiEventPayload,
  parseUiMethodParams,
  parseUiMethodResult,
  type UiEventName,
  type UiEventPayload,
  type UiMethodName,
  type UiMethodParams,
  type UiMethodResult,
  UiProtocol,
} from "./protocol.js";
export type {
  AccountsSnapshot,
  ApprovalSummary,
  ChainSnapshot,
  NetworkListSnapshot,
  SessionSnapshot,
  UiAccountMetaSchema,
  UiKeyringMetaSchema,
  UiSnapshot,
  VaultSnapshot,
} from "./schemas.js";
export {
  AccountsSnapshotSchema,
  ApprovalSummarySchema,
  ChainSnapshotSchema,
  NetworkListSchema,
  SessionSnapshotSchema,
  type UiAccountMeta,
  type UiKeyringMeta,
  UiSnapshotSchema,
  VaultSnapshotSchema,
} from "./schemas.js";
