export { uiActions } from "./actions.js";
export type { UiClient, UiClientOptions, UiProtocolError, UiRemoteError, UiTransport } from "./client/index.js";
export { createUiClient } from "./client/index.js";
export type {
  UiContext,
  UiError,
  UiErrorEnvelope,
  UiEventEnvelope,
  UiPortEnvelope,
  UiRequestEnvelope,
  UiResponseEnvelope,
} from "./protocol/envelopes.js";
export { parseUiEnvelope, UI_CHANNEL } from "./protocol/envelopes.js";
export { UI_EVENT_SNAPSHOT_CHANGED, uiEvents } from "./protocol/events.js";
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
} from "./protocol/index.js";
export { uiMethods } from "./protocol/methods.js";
export type {
  AccountsSnapshot,
  ApprovalSummary,
  ChainSnapshot,
  NetworkListSnapshot,
  SessionSnapshot,
  UiAccountMetaSchema,
  UiBackupStatus,
  UiKeyringMetaSchema,
  UiSnapshot,
  VaultSnapshot,
} from "./protocol/schemas.js";
export {
  AccountsSnapshotSchema,
  ApprovalSummarySchema,
  ChainSnapshotSchema,
  NetworkListSchema,
  SessionSnapshotSchema,
  type UiAccountMeta,
  UiBackupStatusSchema,
  type UiKeyringMeta,
  UiSnapshotSchema,
  VaultSnapshotSchema,
} from "./protocol/schemas.js";
