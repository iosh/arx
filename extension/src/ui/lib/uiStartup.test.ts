import { type ApprovalDetail, UI_EVENT_ENTRY_CHANGED, type UiClientConnectionStatus } from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { loadUiEntryBootstrap, startUiEntryLaunchContextSync } from "./uiStartup";

const mocks = vi.hoisted(() => ({
  hydrateUiEntryMetadata: vi.fn(),
  getBootstrap: vi.fn(),
  getLaunchContext: vi.fn(),
  getUiEnvironment: vi.fn(),
  on: vi.fn(),
  onConnectionStatus: vi.fn(),
  writeCachedUiApprovalDetail: vi.fn(),
  entryChangedListener: null as ((payload: UiEntryMetadata) => void) | null,
  connectionStatusListener: null as ((status: UiClientConnectionStatus) => void) | null,
  stopEntryChanged: vi.fn(),
  stopConnectionStatus: vi.fn(),
}));

vi.mock("@/lib/uiEntryMetadata", () => ({
  getUiEnvironment: mocks.getUiEnvironment,
  hydrateUiEntryMetadata: mocks.hydrateUiEntryMetadata,
}));

vi.mock("./uiApprovalQueries", () => ({
  writeCachedUiApprovalDetail: mocks.writeCachedUiApprovalDetail,
}));

vi.mock("./uiBridgeClient", () => ({
  uiClient: {
    on: mocks.on,
    onConnectionStatus: mocks.onConnectionStatus,
    entry: {
      getBootstrap: mocks.getBootstrap,
      getLaunchContext: mocks.getLaunchContext,
    },
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
    mocks.writeCachedUiApprovalDetail.mockReset();

    mocks.on.mockReset();
    mocks.on.mockImplementation((_event: string, listener: (payload: UiEntryMetadata) => void) => {
      mocks.entryChangedListener = listener;
      return mocks.stopEntryChanged;
    });

    mocks.onConnectionStatus.mockReset();
    mocks.onConnectionStatus.mockImplementation((listener: (status: UiClientConnectionStatus) => void) => {
      mocks.connectionStatusListener = listener;
      return mocks.stopConnectionStatus;
    });
  });

  it("reloads launch context only after a reconnect", async () => {
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

    const stop = startUiEntryLaunchContextSync();

    mocks.connectionStatusListener?.("connected");
    await Promise.resolve();

    expect(mocks.getLaunchContext).not.toHaveBeenCalled();
    expect(mocks.hydrateUiEntryMetadata).not.toHaveBeenCalled();

    mocks.connectionStatusListener?.("disconnected");
    mocks.connectionStatusListener?.("connected");
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.getLaunchContext).toHaveBeenCalledTimes(1);
    expect(mocks.getLaunchContext).toHaveBeenCalledWith({ environment: "notification" });
    expect(mocks.hydrateUiEntryMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.hydrateUiEntryMetadata).toHaveBeenCalledWith(refreshedMetadata);
    expect(mocks.on).toHaveBeenCalledWith(UI_EVENT_ENTRY_CHANGED, expect.any(Function));

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
