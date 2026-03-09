import { afterEach, describe, expect, it, vi } from "vitest";
import type { createPortRouter } from "../portRouter";
import type { BackgroundRuntimeHost } from "../runtimeHost";
import type { ProviderBridgeSnapshot } from "../types";
import { createProviderEventsListener } from "./providerEventsListener";

const makeSnapshot = (namespace: string, overrides?: Partial<ProviderBridgeSnapshot>): ProviderBridgeSnapshot => ({
  namespace,
  chain: {
    chainId: namespace === "conflux" ? "0x405" : "0x1",
    chainRef: namespace === "conflux" ? "conflux:1029" : `${namespace}:1`,
    ...(overrides?.chain ?? {}),
  },
  isUnlocked: true,
  meta: {
    activeChainByNamespace: {
      [namespace]: namespace === "conflux" ? "conflux:1029" : `${namespace}:1`,
    },
    supportedChains: [namespace === "conflux" ? "conflux:1029" : `${namespace}:1`],
    ...(overrides?.meta ?? {}),
  },
});

const toNamespaceList = (value: Iterable<string>) => {
  return [...value].sort();
};

const buildHarness = () => {
  const networkStateHandlers = new Set<() => void>();
  const networkPreferenceHandlers = new Set<
    (payload: { next: { activeChainByNamespace: Record<string, string> } }) => void
  >();
  const snapshots: Record<string, ProviderBridgeSnapshot> = {
    conflux: makeSnapshot("conflux"),
  };

  const listConnectedNamespaces = vi.fn(() => ["conflux"]);
  const broadcastMetaChangedForNamespaces = vi.fn();
  const broadcastChainChangedForNamespaces = vi.fn();
  const broadcastDisconnectForNamespaces = vi.fn();
  const broadcastAccountsChanged = vi.fn();
  const broadcastEvent = vi.fn();
  const broadcastDisconnect = vi.fn();

  const portRouter = {
    listConnectedNamespaces,
    broadcastMetaChangedForNamespaces,
    broadcastChainChangedForNamespaces,
    broadcastDisconnectForNamespaces,
    broadcastAccountsChanged,
    broadcastEvent,
    broadcastDisconnect,
  } as unknown as ReturnType<typeof createPortRouter>;

  const runtimeHost: BackgroundRuntimeHost = {
    getOrInitContext: vi.fn(async () => ({
      controllers: {
        network: {
          onStateChanged: (handler: () => void) => {
            networkStateHandlers.add(handler);
            return () => networkStateHandlers.delete(handler);
          },
        },
        accounts: {
          onStateChanged: () => () => {},
        },
        permissions: {
          onPermissionsChanged: () => () => {},
        },
      },
      session: {
        unlock: {
          onUnlocked: () => () => {},
          onLocked: () => () => {},
        },
      },
      networkPreferences: {
        getActiveChainByNamespace: () => ({ eip155: "eip155:1" }),
        subscribeChanged: (
          handler: (payload: { next: { activeChainByNamespace: Record<string, string> } }) => void,
        ) => {
          networkPreferenceHandlers.add(handler);
          return () => networkPreferenceHandlers.delete(handler);
        },
      },
    })) as unknown as BackgroundRuntimeHost["getOrInitContext"],
    getProviderSnapshot: vi.fn((namespace: string) => {
      const snapshot = snapshots[namespace];
      if (!snapshot) {
        throw new Error(`Missing snapshot for ${namespace}`);
      }
      return snapshot;
    }),
    persistVaultMeta: vi.fn(),
    destroy: vi.fn(),
    applyDebugNamespacesFromEnv: vi.fn(),
  };

  return {
    listener: createProviderEventsListener({ runtimeHost, portRouter }),
    mocks: {
      listConnectedNamespaces,
      broadcastMetaChangedForNamespaces,
      broadcastChainChangedForNamespaces,
      broadcastDisconnectForNamespaces,
    },
    getNetworkStateSubscriptionCount() {
      return networkStateHandlers.size;
    },
    emitNetworkStateChanged() {
      for (const handler of networkStateHandlers) {
        handler();
      }
    },
    emitNetworkPreferencesChanged(next: Record<string, string>) {
      for (const handler of networkPreferenceHandlers) {
        handler({ next: { activeChainByNamespace: next } });
      }
    },
  };
};

describe("providerEventsListener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconciles namespaces that are only present on connected provider ports", async () => {
    const harness = buildHarness();

    harness.listener.start();
    await vi.waitFor(() => expect(harness.getNetworkStateSubscriptionCount()).toBe(1));

    harness.emitNetworkStateChanged();

    await vi.waitFor(() => expect(harness.mocks.broadcastMetaChangedForNamespaces).toHaveBeenCalledTimes(1));
    expect(toNamespaceList(harness.mocks.broadcastMetaChangedForNamespaces.mock.calls[0]?.[0] ?? [])).toEqual([
      "conflux",
    ]);
    expect(toNamespaceList(harness.mocks.broadcastChainChangedForNamespaces.mock.calls[0]?.[0] ?? [])).toEqual([
      "conflux",
    ]);

    harness.emitNetworkPreferencesChanged({ eip155: "eip155:1" });

    await vi.waitFor(() => expect(harness.mocks.listConnectedNamespaces).toHaveBeenCalledTimes(2));
  });
});
