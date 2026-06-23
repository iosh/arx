import type { UiRuntimeAccess } from "@arx/core/runtime";
import type { UiEventEnvelope } from "@arx/core/ui";
import {
  isWalletBridgeRequestMessage,
  parseWalletBridgeRequest,
  type WalletBridgeServer,
} from "@arx/core/wallet/bridge";
import { createUiPortHub } from "./ui/portHub";
import { createUiReadyHandshake } from "./ui/readyHandshake";

export { UI_CHANNEL } from "@arx/core/ui";

type BridgeDeps = {
  uiAccess: UiRuntimeAccess;
  walletBridgeServer: WalletBridgeServer;
};

export const createUiBridge = ({ uiAccess, walletBridgeServer }: BridgeDeps) => {
  const portHub = createUiPortHub();
  const readyHandshake = createUiReadyHandshake({ portHub });

  uiAccess.subscribeUiEvents((event) => {
    portHub.broadcast(event);
  });

  const dispatchPortMessage = async (port: Parameters<typeof portHub.attach>[0], raw: unknown) => {
    if (isWalletBridgeRequestMessage(raw)) {
      const request = parseWalletBridgeRequest(raw);
      const reply = await walletBridgeServer.handleRequest(request);
      portHub.send(port, reply);
      return;
    }

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

  return {
    attachPort,
    broadcastEvent,
  };
};
