import * as z from "zod/mini";

export const WALLET_UI_INPUT_MESSAGE = {
  type: "arx:wallet-ui-input",
} as const;

const WALLET_UI_INPUT_MESSAGE_SCHEMA = z.object({
  type: z.literal(WALLET_UI_INPUT_MESSAGE.type),
});

export const isWalletUiInputMessage = (value: unknown): boolean => {
  return z.safeParse(WALLET_UI_INPUT_MESSAGE_SCHEMA, value).success;
};

export type WalletUiInputSource = Readonly<{
  subscribe(listener: () => void): () => void;
  publish(): void;
}>;

export const createWalletUiInputSource = (): WalletUiInputSource => {
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
};
