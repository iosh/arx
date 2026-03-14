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
  let pendingBroadcast = false;

  const broadcastSnapshotNow = () => {
    const snapshotEvent = buildSnapshotEvent();
    if (!snapshotEvent) return;
    portHub.broadcast(snapshotEvent);
  };

  const requestBroadcast = () => {
    if (broadcastHold > 0) {
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
      if (broadcastHold === 0 && pendingBroadcast) {
        pendingBroadcast = false;
        broadcastSnapshotNow();
      }
    }
  };

  const sendInitialSnapshot = (port: UiPort) => {
    const snapshotEvent = buildSnapshotEvent();
    if (!snapshotEvent) return;
    portHub.send(port, snapshotEvent);
  };

  return {
    requestBroadcast,
    withBroadcastHold,
    sendInitialSnapshot,
  };
};
