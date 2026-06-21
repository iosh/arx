import { createLogger, extendLogger } from "@arx/core/logger";
import type { UiRuntimeAccess } from "@arx/core/runtime";
import type { UiEventEnvelope } from "@arx/core/ui";
import { createUiPortHub } from "./ui/portHub";
import { createUiReadyHandshake } from "./ui/readyHandshake";

export { UI_CHANNEL } from "@arx/core/ui";

const uiLog = createLogger("bg:ui");
const bridgeLog = extendLogger(uiLog, "bridge");

type BridgeDeps = {
  uiAccess: UiRuntimeAccess;
};

export const createUiBridge = ({ uiAccess }: BridgeDeps) => {
  const portHub = createUiPortHub();
  const readyHandshake = createUiReadyHandshake({ portHub });

  const unsubscribeUiEvents = uiAccess.subscribeUiEvents((event) => {
    portHub.broadcast(event);
  });

  const dispatchPortMessage = async (port: Parameters<typeof portHub.attach>[0], raw: unknown) => {
    const dispatched = await uiAccess.dispatchRequest(raw);
    if (!dispatched) return;

    portHub.send(port, dispatched.reply);
  };

  const attachPort = (port: Parameters<typeof portHub.attach>[0]) => {
    portHub.attach(port, async (raw) => await dispatchPortMessage(port, raw));

    readyHandshake.sendReady(port);
  };

  const broadcastEvent = (event: UiEventEnvelope) => {
    portHub.broadcast(event);
  };

  const teardown = () => {
    try {
      unsubscribeUiEvents();
    } catch (error) {
      bridgeLog("failed to remove ui event listener", error);
    }

    portHub.teardown();
  };

  return {
    attachPort,
    broadcastEvent,
    teardown,
  };
};
