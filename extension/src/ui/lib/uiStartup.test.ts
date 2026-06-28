import type { InvokeConnectionStatus } from "@arx/core/invoke";
import type { ApprovalDetail } from "@arx/core/wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { loadUiEntryBootstrap, startUiEntryLaunchContextSync } from "./uiStartup";

const mocks = vi.hoisted(() => ({
  hydrateUiEntryMetadata: vi.fn(),
  getBootstrap: vi.fn(),
  getLaunchContext: vi.fn(),
  getUiEnvironment: vi.fn(),
  subscribeEntryChanged: vi.fn(),
  onConnectionStatus: vi.fn(),
  refreshUiSetupStatusIntoCache: vi.fn(),
  writeCachedUiApprovalDetail: vi.fn(),
  entryChangedListener: null as ((payload: UiEntryMetadata) => void) | null,
  connectionStatusListener: null as ((status: InvokeConnectionStatus) => void) | null,
  stopEntryChanged: vi.fn(),
  stopConnectionStatus: vi.fn(),
}));

vi.mock("@/lib/uiEntryMetadata", () => ({
  getUiEnvironment: mocks.getUiEnvironment,
  hydrateUiEntryMetadata: mocks.hydrateUiEntryMetadata,
}));

vi.mock("./uiApprovalQueries", () => ({
  UI_APPROVALS_QUERY_KEY: ["uiApprovals"],
  writeCachedUiApprovalDetail: mocks.writeCachedUiApprovalDetail,
}));

vi.mock("./uiSetupStatusQuery", () => ({
  refreshUiSetupStatusIntoCache: mocks.refreshUiSetupStatusIntoCache,
}));

vi.mock("./app", () => ({
  app: {
    host: {
      entry: {
        getBootstrap: mocks.getBootstrap,
        getLaunchContext: mocks.getLaunchContext,
      },
    },
    hostEvents: {
      subscribeEntryChanged: mocks.subscribeEntryChanged,
    },
    onConnectionStatus: mocks.onConnectionStatus,
  },
}));

const createMetadata = (overrides?: Partial<UiEntryMetadata>): UiEntryMetadata => ({
  environment: overrides?.environment ?? "notification",
  reason: overrides?.reason ?? "approval_created",
  context: overrides?.context ?? {
    approvalId: "approval-1",
    origin: null,
    method: null,
    chainRef: null,
    namespace: null,
  },
});

type RequestAccountsApprovalDetail = Extract<ApprovalDetail, { kind: "requestAccounts" }>;

const createApprovalDetail = (overrides?: Partial<RequestAccountsApprovalDetail>): RequestAccountsApprovalDetail => ({
  approvalId: overrides?.approvalId ?? "approval-1",
  kind: "requestAccounts",
  source: overrides?.source ?? "provider",
  origin: overrides?.origin ?? "https://dapp.example",
  namespace: overrides?.namespace ?? "eip155",
  chainRef: overrides?.chainRef ?? "eip155:1",
  createdAt: overrides?.createdAt ?? 1,
  actions: overrides?.actions ?? {
    canApprove: true,
    canReject: true,
  },
  request: overrides?.request ?? {
    selectableAccounts: [],
    recommendedAccountKey: null,
  },
  review: null,
});

describe("uiStartup", () => {
  beforeEach(() => {
    mocks.entryChangedListener = null;
    mocks.connectionStatusListener = null;

    mocks.hydrateUiEntryMetadata.mockReset();
    mocks.hydrateUiEntryMetadata.mockImplementation((metadata: UiEntryMetadata) => metadata);

    mocks.getBootstrap.mockReset();
    mocks.getLaunchContext.mockReset();
    mocks.getUiEnvironment.mockReset();
    mocks.getUiEnvironment.mockReturnValue("notification");

    mocks.stopEntryChanged.mockReset();
    mocks.stopConnectionStatus.mockReset();
    mocks.refreshUiSetupStatusIntoCache.mockReset();
    mocks.refreshUiSetupStatusIntoCache.mockResolvedValue({
      session: {
        status: "unlocked",
        isUnlocked: true,
        vaultInitialized: true,
        autoLockDurationMs: 300_000,
        nextAutoLockAt: null,
      },
      onboarding: {
        availability: "ready",
      },
    });
    mocks.writeCachedUiApprovalDetail.mockReset();

    mocks.subscribeEntryChanged.mockReset();
    mocks.subscribeEntryChanged.mockImplementation((listener: (payload: UiEntryMetadata) => void) => {
      mocks.entryChangedListener = listener;
      return mocks.stopEntryChanged;
    });

    mocks.onConnectionStatus.mockReset();
    mocks.onConnectionStatus.mockImplementation((listener: (status: InvokeConnectionStatus) => void) => {
      mocks.connectionStatusListener = listener;
      return mocks.stopConnectionStatus;
    });
  });

  it("reloads launch context only after a reconnect", async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const refreshedMetadata = createMetadata({
      reason: "unlock_required",
      context: {
        approvalId: null,
        origin: "https://example.test",
        method: "eth_requestAccounts",
        chainRef: null,
        namespace: "eip155",
      },
    });
    mocks.getLaunchContext.mockResolvedValue(refreshedMetadata);

    const stop = startUiEntryLaunchContextSync(queryClient as never);

    mocks.connectionStatusListener?.("connected");
    await Promise.resolve();

    expect(mocks.getLaunchContext).not.toHaveBeenCalled();
    expect(mocks.hydrateUiEntryMetadata).not.toHaveBeenCalled();

    mocks.connectionStatusListener?.("disconnected");
    mocks.connectionStatusListener?.("connected");
    await vi.waitFor(() => {
      expect(mocks.getLaunchContext).toHaveBeenCalledTimes(1);
      expect(mocks.getLaunchContext).toHaveBeenCalledWith({ environment: "notification" });
      expect(mocks.refreshUiSetupStatusIntoCache).toHaveBeenCalledTimes(1);
      expect(mocks.refreshUiSetupStatusIntoCache).toHaveBeenCalledWith(queryClient);
      expect(mocks.hydrateUiEntryMetadata).toHaveBeenCalledTimes(1);
      expect(mocks.hydrateUiEntryMetadata).toHaveBeenCalledWith(refreshedMetadata);
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(7);
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiCurrentChainAccounts"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiNetworks"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiApprovals"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["nativeBalance"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiKeyrings"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiKeyringBackupStatus"] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["uiAccountsByKeyring"] });
      expect(mocks.subscribeEntryChanged).toHaveBeenCalledWith(expect.any(Function));
    });

    stop();

    expect(mocks.stopConnectionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.stopEntryChanged).toHaveBeenCalledTimes(1);
  });

  it("hydrates entry metadata and seeds approval detail from bootstrap", async () => {
    const metadata = createMetadata();
    const detail = createApprovalDetail();
    const queryClient = {} as never;
    mocks.getBootstrap.mockResolvedValue({
      entry: metadata,
      requestedApproval: {
        approvalId: "approval-1",
        initialDetail: detail,
      },
    });

    const result = await loadUiEntryBootstrap(queryClient);

    expect(mocks.getBootstrap).toHaveBeenCalledWith({ environment: "notification" });
    expect(mocks.hydrateUiEntryMetadata).toHaveBeenCalledWith(metadata);
    expect(mocks.writeCachedUiApprovalDetail).toHaveBeenCalledWith(queryClient, {
      approvalId: "approval-1",
      detail,
    });
    expect(result).toEqual({
      entry: metadata,
      requestedApproval: {
        approvalId: "approval-1",
        initialDetail: detail,
      },
    });
  });
});
