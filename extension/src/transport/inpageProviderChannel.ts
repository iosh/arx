import type { DuplexChannel } from "@arx/message-channel";
import * as z from "zod/mini";

const INPAGE_PROVIDER_TARGET = {
  content: "arx:dapp-provider:content",
  page: "arx:dapp-provider:page",
} as const;

type InpageProviderTarget = (typeof INPAGE_PROVIDER_TARGET)[keyof typeof INPAGE_PROVIDER_TARGET];

const INPAGE_PROVIDER_MESSAGE_SCHEMA = z.object({
  target: z.enum([INPAGE_PROVIDER_TARGET.content, INPAGE_PROVIDER_TARGET.page]),
  message: z.unknown(),
});

type InpageProviderMessage = Readonly<z.output<typeof INPAGE_PROVIDER_MESSAGE_SCHEMA>>;

export type CreateInpageProviderChannelOptions = Readonly<{
  targetWindow: Window;
  pageOrigin?: string;
}>;

const createMessage = (target: InpageProviderTarget, message: unknown): InpageProviderMessage => ({
  target,
  message,
});

const readMessage = (value: unknown, target: InpageProviderTarget): unknown | null => {
  const decoded = z.safeParse(INPAGE_PROVIDER_MESSAGE_SCHEMA, value);
  if (!decoded.success || decoded.data.target !== target) {
    return null;
  }

  return decoded.data.message;
};

export const createPageToContentMessage = (message: unknown): InpageProviderMessage =>
  createMessage(INPAGE_PROVIDER_TARGET.content, message);

export const readPageToContentMessage = (value: unknown): unknown | null =>
  readMessage(value, INPAGE_PROVIDER_TARGET.content);

export const createContentToPageMessage = (message: unknown): InpageProviderMessage =>
  createMessage(INPAGE_PROVIDER_TARGET.page, message);

export const readContentToPageMessage = (value: unknown): unknown | null =>
  readMessage(value, INPAGE_PROVIDER_TARGET.page);

export const createInpageProviderChannel = ({
  targetWindow,
  pageOrigin = targetWindow.location.origin,
}: CreateInpageProviderChannelOptions): DuplexChannel => ({
  send(message) {
    targetWindow.postMessage(createPageToContentMessage(message), pageOrigin);
  },
  onMessage(listener) {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow || event.origin !== pageOrigin) {
        return;
      }

      const message = readContentToPageMessage(event.data);
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
