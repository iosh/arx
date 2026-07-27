import type { DuplexChannel } from "@arx/message-channel";
import * as z from "zod/mini";

export const PROVIDER_WINDOW_TARGET = {
  content: "arx:dapp-provider:content",
  page: "arx:dapp-provider:page",
} as const;

type ProviderWindowTarget = (typeof PROVIDER_WINDOW_TARGET)[keyof typeof PROVIDER_WINDOW_TARGET];

const PROVIDER_WINDOW_ENVELOPE_SCHEMA = z.object({
  target: z.enum([PROVIDER_WINDOW_TARGET.content, PROVIDER_WINDOW_TARGET.page]),
  message: z.unknown(),
});

type ProviderWindowEnvelope = Readonly<z.output<typeof PROVIDER_WINDOW_ENVELOPE_SCHEMA>>;

export type CreateProviderWindowChannelOptions = Readonly<{
  targetWindow: Window;
  pageOrigin?: string;
}>;

export const createProviderWindowEnvelope = (
  target: ProviderWindowTarget,
  message: unknown,
): ProviderWindowEnvelope => ({ target, message });

export const readProviderWindowEnvelope = (value: unknown, target: ProviderWindowTarget): unknown | null => {
  const decoded = z.safeParse(PROVIDER_WINDOW_ENVELOPE_SCHEMA, value);
  if (!decoded.success || decoded.data.target !== target) {
    return null;
  }

  return decoded.data.message;
};

export const createProviderWindowChannel = ({
  targetWindow,
  pageOrigin = targetWindow.location.origin,
}: CreateProviderWindowChannelOptions): DuplexChannel => ({
  send(message) {
    targetWindow.postMessage(createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.content, message), pageOrigin);
  },
  onMessage(listener) {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow || event.origin !== pageOrigin) {
        return;
      }

      const message = readProviderWindowEnvelope(event.data, PROVIDER_WINDOW_TARGET.page);
      if (message !== null) {
        listener(message);
      }
    };

    targetWindow.addEventListener("message", onMessage);
    return () => {
      targetWindow.removeEventListener("message", onMessage);
    };
  },
  onDisconnect() {
    // Content reports browser transport loss through the Provider wire protocol.
    return () => undefined;
  },
});
