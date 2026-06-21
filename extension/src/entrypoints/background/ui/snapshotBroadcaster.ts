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
    if (responseFence > 0 || !pendingBroadcast) {
      return;
    }

    pendingBroadcast = false;
    broadcastSnapshotNow();
  };

  const requestBroadcast = () => {
    if (responseFence > 0) {
      pendingBroadcast = true;
      return;
    }

    broadcastSnapshotNow();
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
    if (!pendingBroadcast && responseFence === 0) {
      lastBroadcastSnapshotKey = snapshotKey;
    }
  };

  return {
    requestBroadcast,
    withResponseFence,
    sendInitialSnapshot,
  };
};
