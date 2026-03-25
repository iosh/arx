import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import type { ProviderBridgeSnapshot } from "../types";

type ProviderEventBroadcasterDeps = {
  getConnectedPorts: () => Runtime.Port[];
  getSessionIdForPort: (port: Runtime.Port) => string | null;
  getPortsBoundToNamespaces: (namespaces: Iterable<string>) => Runtime.Port[];
  findPortSnapshot: (port: Runtime.Port) => ProviderBridgeSnapshot | null;
  syncPortContextsForPorts: (ports: Runtime.Port[]) => void;
  postEnvelope: (port: Runtime.Port, envelope: Envelope) => boolean;
  dropStalePort: (port: Runtime.Port, reason: string, error?: unknown) => void;
  getPermittedAccountsForPort: (port: Runtime.Port, snapshot: ProviderBridgeSnapshot) => Promise<string[]>;
};

export const createProviderEventBroadcaster = (deps: ProviderEventBroadcasterDeps) => {
  const {
    getConnectedPorts,
    getSessionIdForPort,
    getPortsBoundToNamespaces,
    findPortSnapshot,
    syncPortContextsForPorts,
    postEnvelope,
    dropStalePort,
    getPermittedAccountsForPort,
  } = deps;

  type ActivePortProjection = {
    port: Runtime.Port;
    sessionId: string;
    snapshot: ProviderBridgeSnapshot;
  };

  const resolveActivePortProjections = (ports: Runtime.Port[], missingSnapshotReason: string): ActivePortProjection[] => {
    syncPortContextsForPorts(ports);

    const stalePorts: Runtime.Port[] = [];
    const projections: ActivePortProjection[] = [];

    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;

      const snapshot = findPortSnapshot(port);
      if (!snapshot) {
        stalePorts.push(port);
        continue;
      }

      projections.push({ port, sessionId, snapshot });
    }

    for (const port of stalePorts) {
      dropStalePort(port, missingSnapshotReason);
    }

    return projections;
  };

  const broadcastSafe = (
    shouldInclude: (port: Runtime.Port) => boolean,
    send: (port: Runtime.Port) => boolean,
    reason: string,
  ) => {
    const stalePorts: Runtime.Port[] = [];

    for (const port of getConnectedPorts()) {
      if (!shouldInclude(port)) continue;
      if (!send(port)) {
        stalePorts.push(port);
      }
    }

    for (const port of stalePorts) {
      dropStalePort(port, reason);
    }
  };

  const broadcastMetaChangedForNamespaces = (namespaces: Iterable<string>) => {
    const targetPortSet = new Set(getPortsBoundToNamespaces(namespaces));

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const [projection] = resolveActivePortProjections([port], "broadcast_meta_changed_snapshot_missing");
        if (!projection) return false;

        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId: projection.sessionId,
          type: "event",
          payload: { event: PROVIDER_EVENTS.metaChanged, params: [projection.snapshot.meta] },
        });
      },
      "broadcast_meta_changed_failed",
    );
  };

  const broadcastChainChangedForNamespaces = (namespaces: Iterable<string>) => {
    const targetPortSet = new Set(getPortsBoundToNamespaces(namespaces));

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const [projection] = resolveActivePortProjections([port], "broadcast_chain_changed_snapshot_missing");
        if (!projection) return false;

        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId: projection.sessionId,
          type: "event",
          payload: {
            event: PROVIDER_EVENTS.chainChanged,
            params: [
              {
                chainId: projection.snapshot.chain.chainId,
                chainRef: projection.snapshot.chain.chainRef,
                isUnlocked: projection.snapshot.isUnlocked,
                meta: projection.snapshot.meta,
              },
            ],
          },
        });
      },
      "broadcast_chain_changed_failed",
    );
  };

  const broadcastAccountsChangedForPorts = async (ports: Runtime.Port[]) => {
    const projections = resolveActivePortProjections(ports, "broadcast_accounts_changed_snapshot_missing");

    await Promise.all(
      projections.map(async ({ port, sessionId, snapshot }) => {
        try {
          const accounts = await getPermittedAccountsForPort(port, snapshot);
          const activeSessionId = getSessionIdForPort(port);
          if (!activeSessionId || activeSessionId !== sessionId) {
            return;
          }

          const ok = postEnvelope(port, {
            channel: CHANNEL,
            sessionId,
            type: "event",
            payload: { event: PROVIDER_EVENTS.accountsChanged, params: [accounts] },
          });

          if (!ok) {
            dropStalePort(port, "broadcast_accounts_changed_failed");
          }
        } catch (error) {
          dropStalePort(port, "broadcast_accounts_changed_error", error);
        }
      }),
    );
  };

  const broadcastAccountsChanged = async () => {
    await broadcastAccountsChangedForPorts(getConnectedPorts());
  };

  const broadcastAccountsChangedForNamespaces = async (namespaces: Iterable<string>) => {
    await broadcastAccountsChangedForPorts(getPortsBoundToNamespaces(namespaces));
  };

  const broadcastEvent = (event: string, params: unknown[]) => {
    broadcastSafe(
      (port) => !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        if (!sessionId) return true;

        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event, params },
        });
      },
      "broadcast_event_failed",
    );
  };

  return {
    broadcastMetaChangedForNamespaces,
    broadcastChainChangedForNamespaces,
    broadcastAccountsChangedForNamespaces,
    broadcastAccountsChanged,
    broadcastEvent,
  };
};
