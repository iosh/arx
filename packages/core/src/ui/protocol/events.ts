export const UI_EVENT_READY = "ui:ready" as const;
export const UI_EVENT_SESSION_CHANGED = "ui:sessionChanged" as const;
export const UI_EVENT_ENTRY_CHANGED = "ui:entryChanged" as const;
export const UI_EVENT_APPROVALS_CHANGED = "ui:approvalsChanged" as const;
export const UI_EVENT_APPROVAL_DETAIL_CHANGED = "ui:approvalDetailChanged" as const;
export const UI_EVENT_TRANSACTIONS_CHANGED = "ui:transactionsChanged" as const;

export type UiEventDefinition = Record<string, never>;

export const uiEvents = {
  [UI_EVENT_READY]: {},
  [UI_EVENT_SESSION_CHANGED]: {},
  [UI_EVENT_ENTRY_CHANGED]: {},
  [UI_EVENT_APPROVALS_CHANGED]: {},
  [UI_EVENT_APPROVAL_DETAIL_CHANGED]: {},
  [UI_EVENT_TRANSACTIONS_CHANGED]: {},
} as const satisfies Record<string, UiEventDefinition>;
