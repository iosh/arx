export const UI_EVENT_SNAPSHOT_CHANGED = "ui:snapshotChanged" as const;
export const UI_EVENT_ENTRY_CHANGED = "ui:entryChanged" as const;
export const UI_EVENT_APPROVALS_CHANGED = "ui:approvalsChanged" as const;
export const UI_EVENT_APPROVAL_DETAIL_CHANGED = "ui:approvalDetailChanged" as const;
export const UI_EVENT_TRANSACTIONS_CHANGED = "ui:transactionsChanged" as const;

export type UiEventDefinition = Record<string, never>;

export const uiEvents = {
  [UI_EVENT_SNAPSHOT_CHANGED]: {},
  [UI_EVENT_ENTRY_CHANGED]: {},
  [UI_EVENT_APPROVALS_CHANGED]: {},
  [UI_EVENT_APPROVAL_DETAIL_CHANGED]: {},
  [UI_EVENT_TRANSACTIONS_CHANGED]: {},
} as const satisfies Record<string, UiEventDefinition>;
