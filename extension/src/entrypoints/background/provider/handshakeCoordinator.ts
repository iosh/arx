import { CHANNEL, type Envelope, PROTOCOL_VERSION } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import type { BackgroundContext } from "../runtimeHost";
import type { ProviderBridgeSnapshot } from "../types";

type ProviderHandshakeCoordinatorDeps = {
  getContext: () => Promise<BackgroundContext>;
  getExpectedSessionId: (port: Runtime.Port) => string | null;
  writeSessionId: (port: Runtime.Port, sessionId: string) => void;
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot | null;
  syncPortContext: (port: Runtime.Port, snapshot: ProviderBridgeSnapshot) => void;
  listPermittedAccountsForPort: (port: Runtime.Port, snapshot: ProviderBridgeSnapshot) => Promise<string[]>;
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
  getContext,
  getExpectedSessionId,
  writeSessionId,
  getProviderSnapshot,
  syncPortContext,
  listPermittedAccountsForPort,
  clearPendingForPort,
  cancelApprovalsForSession,
  postEnvelopeOrDrop,
  dropStalePort,
}: ProviderHandshakeCoordinatorDeps) => {
  const handleHandshake = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "handshake" }>) => {
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

    await getContext();
    const snapshot = getProviderSnapshot(namespace);
    if (!snapshot) {
      dropStalePort(port, "handshake_snapshot_unavailable");
      return;
    }

    syncPortContext(port, snapshot);
    writeSessionId(port, envelope.sessionId);

    const accounts = await listPermittedAccountsForPort(port, snapshot);

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
  };

  return {
    handleHandshake,
  };
};
