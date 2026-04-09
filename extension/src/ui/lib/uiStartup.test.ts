import { UI_EVENT_ENTRY_CHANGED, type UiClientConnectionStatus } from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { startUiEntryLaunchContextSync } from "./uiStartup";

const mocks = vi.hoisted(() => ({
  hydrateUiEntryMetadata: vi.fn(),
  getLaunchContext: vi.fn(),
  getUiEnvironment: vi.fn(),
  on: vi.fn(),
  onConnectionStatus: vi.fn(),
  entryChangedListener: null as ((payload: UiEntryMetadata) => void) | null,
  connectionStatusListener: null as ((status: UiClientConnectionStatus) => void) | null,
  stopEntryChanged: vi.fn(),
  stopConnectionStatus: vi.fn(),
}));

vi.mock("@/lib/uiEntryMetadata", () => ({
  getUiEnvironment: mocks.getUiEnvironment,
  hydrateUiEntryMetadata: mocks.hydrateUiEntryMetadata,
}));

vi.mock("./uiBridgeClient", () => ({
  uiClient: {
    on: mocks.on,
    onConnectionStatus: mocks.onConnectionStatus,
    entry: {
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

describe("uiStartup", () => {
  beforeEach(() => {
    mocks.entryChangedListener = null;
    mocks.connectionStatusListener = null;

    mocks.hydrateUiEntryMetadata.mockReset();
    mocks.hydrateUiEntryMetadata.mockImplementation((metadata: UiEntryMetadata) => metadata);

    mocks.getLaunchContext.mockReset();
    mocks.getUiEnvironment.mockReset();
    mocks.getUiEnvironment.mockReturnValue("notification");

    mocks.stopEntryChanged.mockReset();
    mocks.stopConnectionStatus.mockReset();

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
});
