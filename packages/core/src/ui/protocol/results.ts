import type {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_ENTRY_CHANGED,
  UI_EVENT_READY,
  UI_EVENT_SESSION_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "./events.js";
import type { UiEntryBootstrap, UiEntryLaunchContext } from "./methods/entry.js";

export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number | undefined;
};

export type UiMethodResultMap = {
  "ui.entry.getLaunchContext": UiEntryLaunchContext;
  "ui.entry.getBootstrap": UiEntryBootstrap;
  "ui.onboarding.openTab": UiOnboardingOpenTabResult;
};

export type UiEventPayloadMap = {
  [UI_EVENT_READY]: { ready: true };
  [UI_EVENT_SESSION_CHANGED]: { reason: "changed" };
  [UI_EVENT_ENTRY_CHANGED]: UiEntryLaunchContext;
  [UI_EVENT_APPROVALS_CHANGED]: { reason: "changed" };
  [UI_EVENT_APPROVAL_DETAIL_CHANGED]: { approvalId: string };
  [UI_EVENT_TRANSACTIONS_CHANGED]: { transactionIds: string[] };
};
