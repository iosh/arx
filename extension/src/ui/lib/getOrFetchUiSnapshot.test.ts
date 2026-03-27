import type { UiSnapshot } from "@arx/core/ui";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrFetchUiSnapshot } from "./getOrFetchUiSnapshot";
import { UI_SNAPSHOT_QUERY_KEY } from "./uiSnapshotQuery";

const { mockSnapshotGet, mockWaitForSnapshot } = vi.hoisted(() => ({
  mockWaitForSnapshot: vi.fn(),
  mockSnapshotGet: vi.fn(),
}));

vi.mock("@/ui/lib/uiBridgeClient", () => ({
  uiClient: {
    waitForSnapshot: mockWaitForSnapshot,
    snapshot: {
      get: mockSnapshotGet,
    },
  },
}));

describe("getOrFetchUiSnapshot", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    mockWaitForSnapshot.mockReset();
    mockSnapshotGet.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("returns the cached snapshot when a fresh fetch is not requested", async () => {
    const cached = { vault: { initialized: true } } as UiSnapshot;
    queryClient.setQueryData(UI_SNAPSHOT_QUERY_KEY, cached);

    await expect(getOrFetchUiSnapshot(queryClient)).resolves.toBe(cached);
    expect(mockWaitForSnapshot).not.toHaveBeenCalled();
    expect(mockSnapshotGet).not.toHaveBeenCalled();
  });

  it("loads the first snapshot through waitForSnapshot and stores it in cache", async () => {
    const snapshot = { vault: { initialized: true }, session: { isUnlocked: false } } as UiSnapshot;
    mockWaitForSnapshot.mockResolvedValue(snapshot);

    await expect(getOrFetchUiSnapshot(queryClient)).resolves.toBe(snapshot);
    expect(mockWaitForSnapshot).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(UI_SNAPSHOT_QUERY_KEY)).toBe(snapshot);
  });

  it("bypasses the cache for fresh reads and updates the cached snapshot", async () => {
    const cached = { vault: { initialized: false } } as UiSnapshot;
    const fresh = { vault: { initialized: true } } as UiSnapshot;
    queryClient.setQueryData(UI_SNAPSHOT_QUERY_KEY, cached);
    mockSnapshotGet.mockResolvedValue(fresh);

    await expect(getOrFetchUiSnapshot(queryClient, { fresh: true })).resolves.toBe(fresh);
    expect(mockSnapshotGet).toHaveBeenCalledTimes(1);
    expect(mockWaitForSnapshot).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(UI_SNAPSHOT_QUERY_KEY)).toStrictEqual(fresh);
  });
});
