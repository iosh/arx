import type { UiEventEnvelope } from "@arx/core/ui";
import type { UiPort } from "./portHub";

type UiSnapshotBroadcasterDeps = {
  portHub: {
    broadcast: (envelope: UiEventEnvelope) => void;
    send: (port: UiPort, envelope: UiEventEnvelope) => boolean;
  };
  buildSnapshotEvent: () => UiEventEnvelope | null;
};

export const createUiSnapshotBroadcaster = ({ portHub, buildSnapshotEvent }: UiSnapshotBroadcasterDeps) => {
  let broadcastHold = 0;
  let responseFence = 0;
  let lastBroadcastSnapshotKey: string | null = null;
  let pendingBroadcast = false;

  const buildSnapshotKey = (snapshotEvent: UiEventEnvelope) => JSON.stringify(snapshotEvent);

  const broadcastSnapshotNow = () => {
    const snapshotEvent = buildSnapshotEvent();
    if (!snapshotEvent) return;
    const snapshotKey = buildSnapshotKey(snapshotEvent);
    if (snapshotKey === lastBroadcastSnapshotKey) {
      return;
    }

    lastBroadcastSnapshotKey = snapshotKey;
    portHub.broadcast(snapshotEvent);
  };

  const flushPendingBroadcast = () => {
    if (broadcastHold > 0 || responseFence > 0 || !pendingBroadcast) {
      return;
    }

    pendingBroadcast = false;
    broadcastSnapshotNow();
  };

  const requestBroadcast = () => {
    if (broadcastHold > 0 || responseFence > 0) {
      pendingBroadcast = true;
      return;
    }

    broadcastSnapshotNow();
  };

  const withBroadcastHold = async <T>(fn: () => Promise<T>): Promise<T> => {
    broadcastHold += 1;
    try {
      return await fn();
    } finally {
      broadcastHold -= 1;
      flushPendingBroadcast();
    }
  };

  const withResponseFence = async <T>(fn: () => Promise<T>): Promise<T> => {
    responseFence += 1;
    try {
      return await fn();
    } finally {
      responseFence -= 1;
      flushPendingBroadcast();
    }
  };

  const sendInitialSnapshot = (port: UiPort) => {
    const snapshotEvent = buildSnapshotEvent();
    if (!snapshotEvent) return;
    const snapshotKey = buildSnapshotKey(snapshotEvent);
    const sent = portHub.send(port, snapshotEvent);
    if (!sent) return;

    // When the broadcaster is idle, the initial snapshot has effectively
    // reached every attached port, so it can advance duplicate suppression.
    // While a broadcast is queued or fenced, older ports may still be missing
    // that snapshot, so the global broadcast key must stay untouched.
    if (!pendingBroadcast && broadcastHold === 0 && responseFence === 0) {
      lastBroadcastSnapshotKey = snapshotKey;
    }
  };

  return {
    requestBroadcast,
    withBroadcastHold,
    withResponseFence,
    sendInitialSnapshot,
  };
};
