export const UI_EVENT_READY = "ui:ready" as const;
export const UI_EVENT_ENTRY_CHANGED = "ui:entryChanged" as const;

export type UiEventDefinition = Record<string, never>;

export const uiEvents = {
  [UI_EVENT_READY]: {},
  [UI_EVENT_ENTRY_CHANGED]: {},
} as const satisfies Record<string, UiEventDefinition>;
