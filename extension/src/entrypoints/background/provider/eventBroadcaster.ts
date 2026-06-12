import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import type { ProviderBridgeConnectionState, ProviderBridgeSnapshot } from "../types";
import type { ProviderConnectionScope } from "./providerPortConnections";

type ProviderEventBroadcasterDeps = {
  getConnectedPorts: () => Runtime.Port[];
  getSessionIdForPort: (port: Runtime.Port) => string | null;
  getPortsForConnectionScopes: (scopes: Iterable<ProviderConnectionScope>) => Runtime.Port[];
  postEnvelope: (port: Runtime.Port, envelope: Envelope) => boolean;
  dropStalePort: (port: Runtime.Port, reason: string, error?: unknown) => void;
};

type ProviderConnectionChangedFields = {
  chain: boolean;
  accounts: boolean;
};

export const createProviderEventBroadcaster = (deps: ProviderEventBroadcasterDeps) => {
  const { getConnectedPorts, getSessionIdForPort, getPortsForConnectionScopes, postEnvelope, dropStalePort } = deps;

  type ActivePortSession = {
    port: Runtime.Port;
    sessionId: string;
  };

  const readActivePortSessions = (ports: Runtime.Port[]): ActivePortSession[] => {
    const activeSessions: ActivePortSession[] = [];

    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;
      activeSessions.push({ port, sessionId });
    }

    return activeSessions;
  };

  const broadcastToPorts = (ports: Runtime.Port[], buildEnvelope: (sessionId: string) => Envelope, reason: string) => {
    const stalePorts: Runtime.Port[] = [];

    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;

      if (!postEnvelope(port, buildEnvelope(sessionId))) {
        stalePorts.push(port);
      }
    }

    for (const port of stalePorts) {
      dropStalePort(port, reason);
    }
  };

  const buildChainChangedParams = (snapshot: ProviderBridgeSnapshot) => [
    {
      chainId: snapshot.chain.chainId,
      chainRef: snapshot.chain.chainRef,
      isUnlocked: snapshot.isUnlocked,
    },
  ];

  const broadcastChainChangedForPorts = (ports: Runtime.Port[], state: ProviderBridgeConnectionState) => {
    broadcastToPorts(
      ports,
      (sessionId) => ({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: {
          event: PROVIDER_EVENTS.chainChanged,
          params: buildChainChangedParams(state.snapshot),
        },
      }),
      "broadcast_chain_changed_failed",
    );
  };

  const broadcastAccountsChangedForPorts = (ports: Runtime.Port[], state: ProviderBridgeConnectionState) => {
    const activeSessions = readActivePortSessions(ports);
    const stalePorts: Runtime.Port[] = [];

    for (const { port, sessionId } of activeSessions) {
      const activeSessionId = getSessionIdForPort(port);
      if (!activeSessionId || activeSessionId !== sessionId) {
        continue;
      }

      const ok = postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.accountsChanged, params: [state.accounts] },
      });

      if (!ok) {
        stalePorts.push(port);
      }
    }

    for (const port of stalePorts) {
      dropStalePort(port, "broadcast_accounts_changed_failed");
    }
  };

  const broadcastConnectionStateChange = (
    scope: ProviderConnectionScope,
    state: ProviderBridgeConnectionState,
    changed: ProviderConnectionChangedFields,
  ) => {
    const ports = getPortsForConnectionScopes([scope]);

    if (changed.chain) {
      broadcastChainChangedForPorts(ports, state);
    }
    if (changed.accounts) {
      broadcastAccountsChangedForPorts(ports, state);
    }
  };

  const broadcastEvent = (event: string, params: unknown[]) => {
    broadcastToPorts(
      getConnectedPorts(),
      (sessionId) => ({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event, params },
      }),
      "broadcast_event_failed",
    );
  };

  return {
    broadcastConnectionStateChange,
    broadcastEvent,
  };
};
