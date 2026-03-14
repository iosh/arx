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
    const targetPorts = getPortsBoundToNamespaces(namespaces);
    syncPortContextsForPorts(targetPorts);
    const targetPortSet = new Set(targetPorts);

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        const snapshot = findPortSnapshot(port);
        if (!sessionId || !snapshot) return false;

        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event: PROVIDER_EVENTS.metaChanged, params: [snapshot.meta] },
        });
      },
      "broadcast_meta_changed_failed",
    );
  };

  const broadcastChainChangedForNamespaces = (namespaces: Iterable<string>) => {
    const targetPorts = getPortsBoundToNamespaces(namespaces);
    syncPortContextsForPorts(targetPorts);
    const targetPortSet = new Set(targetPorts);

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        const snapshot = findPortSnapshot(port);
        if (!sessionId || !snapshot) return false;

        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: {
            event: PROVIDER_EVENTS.chainChanged,
            params: [
              {
                chainId: snapshot.chain.chainId,
                chainRef: snapshot.chain.chainRef,
                isUnlocked: snapshot.isUnlocked,
                meta: snapshot.meta,
              },
            ],
          },
        });
      },
      "broadcast_chain_changed_failed",
    );
  };

  const broadcastAccountsChanged = () => {
    for (const port of getConnectedPorts()) {
      const sessionId = getSessionIdForPort(port);
      const snapshot = findPortSnapshot(port);
      if (!sessionId || !snapshot) continue;

      void (async () => {
        try {
          const accounts = await getPermittedAccountsForPort(port, snapshot);
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
      })();
    }
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
    broadcastAccountsChanged,
    broadcastEvent,
  };
};
