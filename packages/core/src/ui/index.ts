export { uiActions, uiCommonActions } from "./actions.js";
export type { UiClient, UiClientConnectionStatus, UiClientOptions, UiTransport } from "./client/index.js";
export { createUiClient, isUiProtocolError, isUiRemoteError, UiProtocolError, UiRemoteError } from "./client/index.js";
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
export {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_ENTRY_CHANGED,
  UI_EVENT_READY,
  UI_EVENT_SESSION_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
  uiEvents,
} from "./protocol/events.js";
export {
  isUiEventName,
  isUiMethodName,
  parseUiMethodParams,
  type UiEventName,
  type UiEventPayload,
  type UiMethodName,
  type UiMethodParams,
  type UiMethodResult,
  UiProtocol,
} from "./protocol/index.js";
export { uiMethods } from "./protocol/methods.js";
export type { ListTransactionsQuery, UiTransaction } from "./protocol/models/transactions.js";
export { ListTransactionsQuerySchema } from "./protocol/models/transactions.js";
export type {
  ApprovalDetail,
  ApprovalListEntry,
  ChainSnapshot,
  UiAccountMeta,
  UiBackupStatus,
  UiKeyringMeta,
  UiPermissionsSnapshot,
} from "./protocol/schemas.js";
