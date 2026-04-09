import { createLogger, extendLogger } from "@arx/core/logger";
import type { UiRuntimeAccess } from "@arx/core/runtime";
import type { UiEventEnvelope } from "@arx/core/ui";
import { createUiPortHub } from "./ui/portHub";
import { createUiSnapshotBroadcaster } from "./ui/snapshotBroadcaster";

export { UI_CHANNEL } from "@arx/core/ui";

const uiLog = createLogger("bg:ui");
const bridgeLog = extendLogger(uiLog, "bridge");

type BridgeDeps = {
  uiAccess: UiRuntimeAccess;
};

export const createUiBridge = ({ uiAccess }: BridgeDeps) => {
  const portHub = createUiPortHub();

  const buildSnapshotEventSafely = () => {
    try {
      return uiAccess.buildSnapshotEvent();
    } catch (error) {
      bridgeLog("failed to build snapshot", error);
      return null;
    }
  };

  const snapshotBroadcaster = createUiSnapshotBroadcaster({
    portHub,
    buildSnapshotEvent: buildSnapshotEventSafely,
  });

  const unsubscribeStateChanged = uiAccess.subscribeStateChanged(() => {
    snapshotBroadcaster.requestBroadcast();
  });

  const dispatchPortMessage = async (port: Parameters<typeof portHub.attach>[0], raw: unknown) => {
    const broadcastPolicy = uiAccess.getRequestBroadcastPolicy(raw);

    const processRequest = async () => {
      const dispatched = await uiAccess.dispatchRequest(raw);
      if (!dispatched) return;

      portHub.send(port, dispatched.reply);

      if (dispatched.shouldBroadcastSnapshot) {
        snapshotBroadcaster.requestBroadcast();
      }
    };

    const runRequest = async () => {
      if (broadcastPolicy.holdBroadcast) {
        await snapshotBroadcaster.withBroadcastHold(processRequest);
        return;
      }

      await processRequest();
    };

    if (broadcastPolicy.fenceSnapshotBroadcast) {
      await snapshotBroadcaster.withResponseFence(runRequest);
      return;
    }

    await runRequest();
  };

  const attachPort = (port: Parameters<typeof portHub.attach>[0]) => {
    portHub.attach(port, async (raw) => await dispatchPortMessage(port, raw));

    snapshotBroadcaster.sendInitialSnapshot(port);
  };

  const broadcastEvent = (event: UiEventEnvelope) => {
    portHub.broadcast(event);
  };

  const teardown = () => {
    try {
      unsubscribeStateChanged();
    } catch (error) {
      bridgeLog("failed to remove ui access listener", error);
    }

    portHub.teardown();
  };

  return {
    attachPort,
    broadcastEvent,
    teardown,
  };
};
