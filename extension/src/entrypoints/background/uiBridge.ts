import { createLogger, extendLogger } from "@arx/core/logger";
import type { UiRuntimeAccess } from "@arx/core/ui/server";
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

  const maybeWithHold = async (raw: unknown, fn: () => Promise<void>) => {
    if (uiAccess.shouldHoldBroadcast(raw)) {
      await snapshotBroadcaster.withBroadcastHold(fn);
      return;
    }
    await fn();
  };

  const attachPort = (port: Parameters<typeof portHub.attach>[0]) => {
    portHub.attach(port, async (raw) => {
      await maybeWithHold(raw, async () => {
        const dispatched = await uiAccess.dispatchRequest(raw);
        if (!dispatched) return;

        portHub.send(port, dispatched.reply);

        if (dispatched.shouldBroadcastSnapshot) {
          snapshotBroadcaster.requestBroadcast();
        }
      });
    });

    snapshotBroadcaster.sendInitialSnapshot(port);
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
    teardown,
  };
};
