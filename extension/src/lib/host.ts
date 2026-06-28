import type { MethodCall, MethodHandlerTree } from "@arx/core/invoke";
import { createMethodApiProxy } from "@arx/core/invoke";
import type { ApprovalDetail } from "@arx/core/wallet";

export const UI_CHANNEL = "arx:ui" as const;
export const HOST_TARGET = "host" as const;
export const HOST_ENTRY_CHANGED_EVENT = "entryChanged" as const;

export const UI_ENVIRONMENTS = ["popup", "notification", "onboarding"] as const;
export const UI_ENTRY_REASONS = [
  "idle",
  "manual_open",
  "install",
  "onboarding_required",
  "approval_created",
  "unlock_required",
] as const;

export type UiEnvironment = (typeof UI_ENVIRONMENTS)[number];
export type UiEntryReason = (typeof UI_ENTRY_REASONS)[number];

export type UiEntryContext = {
  approvalId: string | null;
  origin: string | null;
  method: string | null;
  chainRef: string | null;
  namespace: string | null;
};

export type UiEntryLaunchContext = {
  environment: UiEnvironment;
  reason: UiEntryReason;
  context: UiEntryContext;
};

export type UiEntryBootstrap = {
  entry: UiEntryLaunchContext;
  requestedApproval: {
    approvalId: string;
    initialDetail: ApprovalDetail;
  } | null;
};

export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number;
};

export type HostApi = Readonly<{
  entry: Readonly<{
    getLaunchContext(params: { environment: UiEnvironment }): Promise<UiEntryLaunchContext>;
    getBootstrap(params: { environment: UiEnvironment }): Promise<UiEntryBootstrap>;
  }>;
  onboarding: Readonly<{
    openTab(params: { reason: string }): Promise<UiOnboardingOpenTabResult>;
  }>;
}>;

export type HostMethods = Readonly<{
  getEntryLaunchContext(params: { environment: UiEnvironment }): UiEntryLaunchContext | Promise<UiEntryLaunchContext>;
  getEntryBootstrap(params: { environment: UiEnvironment }): Promise<UiEntryBootstrap>;
  openOnboardingTab(reason: string): Promise<UiOnboardingOpenTabResult>;
}>;

const UI_ENVIRONMENT_SET: ReadonlySet<string> = new Set(UI_ENVIRONMENTS);
const UI_ENTRY_REASON_SET: ReadonlySet<string> = new Set(UI_ENTRY_REASONS);

export const parseUiEnvironment = (value: string): UiEnvironment | null => {
  return UI_ENVIRONMENT_SET.has(value) ? (value as UiEnvironment) : null;
};

export const parseUiEntryReason = (value: string): UiEntryReason | null => {
  return UI_ENTRY_REASON_SET.has(value) ? (value as UiEntryReason) : null;
};

export const hostMethodHandlers = {
  entry: {
    getLaunchContext: (host, params) => host.getEntryLaunchContext(params),
    getBootstrap: (host, params) => host.getEntryBootstrap(params),
  },
  onboarding: {
    openTab: (host, params) => host.openOnboardingTab(params.reason),
  },
} as const satisfies MethodHandlerTree<HostMethods, HostApi>;

export const createHostApiClient = (call: MethodCall): HostApi => {
  return createMethodApiProxy<HostApi>(call);
};
