import { UI_EVENT_READY, type UiEventEnvelope } from "@arx/core/ui";
import type { UiPort } from "./portHub";

type UiReadyHandshakeDeps = {
  portHub: {
    send: (port: UiPort, envelope: UiEventEnvelope) => boolean;
  };
};

const readyEvent = {
  type: "ui:event",
  event: UI_EVENT_READY,
  payload: { ready: true },
} as const satisfies UiEventEnvelope;

export const createUiReadyHandshake = ({ portHub }: UiReadyHandshakeDeps) => {
  const sendReady = (port: UiPort) => {
    portHub.send(port, readyEvent);
  };

  return { sendReady };
};
