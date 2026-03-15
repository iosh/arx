import { CHANNEL, type Envelope, PROTOCOL_VERSION } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import type { ProviderBridgeConnectionState, ProviderBridgeSnapshot } from "../types";

type ProviderHandshakeCoordinatorDeps = {
  getExpectedSessionId: (port: Runtime.Port) => string | null;
  writeSessionId: (port: Runtime.Port, sessionId: string) => void;
  getProviderConnectionState: (port: Runtime.Port, namespace: string) => Promise<ProviderBridgeConnectionState | null>;
  syncPortContext: (port: Runtime.Port, snapshot: ProviderBridgeSnapshot) => void;
  clearPendingForPort: (port: Runtime.Port) => void;
  cancelApprovalsForSession: (port: Runtime.Port, sessionId: string, logReason: string) => Promise<void>;
  postEnvelopeOrDrop: (port: Runtime.Port, envelope: Envelope, reason: string) => boolean;
  dropStalePort: (port: Runtime.Port, reason: string, error?: unknown) => void;
};

const parseHandshakeNamespace = (envelope: Extract<Envelope, { type: "handshake" }>) => {
  const namespace = envelope.payload.namespace.trim();
  return namespace.length > 0 ? namespace : null;
};

export const createProviderHandshakeCoordinator = ({
  getExpectedSessionId,
  writeSessionId,
  getProviderConnectionState,
  syncPortContext,
  clearPendingForPort,
  cancelApprovalsForSession,
  postEnvelopeOrDrop,
  dropStalePort,
}: ProviderHandshakeCoordinatorDeps) => {
  const handleHandshake = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "handshake" }>) => {
    try {
      const namespace = parseHandshakeNamespace(envelope);
      if (!namespace) {
        dropStalePort(port, "handshake_missing_namespace");
        return;
      }

      const expectedSessionId = getExpectedSessionId(port);
      if (expectedSessionId && envelope.sessionId !== expectedSessionId) {
        clearPendingForPort(port);
        await cancelApprovalsForSession(port, expectedSessionId, "failed to expire approvals on session rotation");
      }

      const connectionState = await getProviderConnectionState(port, namespace);
      if (!connectionState) {
        dropStalePort(port, "handshake_state_unavailable");
        return;
      }

      const { snapshot, accounts } = connectionState;
      syncPortContext(port, snapshot);
      writeSessionId(port, envelope.sessionId);

      postEnvelopeOrDrop(
        port,
        {
          channel: CHANNEL,
          sessionId: envelope.sessionId,
          type: "handshake_ack",
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            handshakeId: envelope.payload.handshakeId,
            chainId: snapshot.chain.chainId,
            chainRef: snapshot.chain.chainRef,
            accounts,
            isUnlocked: snapshot.isUnlocked,
            meta: snapshot.meta,
          },
        },
        "send_handshake_failed",
      );
    } catch (error) {
      dropStalePort(port, "handshake_failed", error);
    }
  };

  return {
    handleHandshake,
  };
};
