export const WALLET_UI_INPUT_MESSAGE = {
  type: "arx:wallet-ui-input",
} as const;

export const isWalletUiInputMessage = (value: unknown): value is typeof WALLET_UI_INPUT_MESSAGE => {
  return typeof value === "object" && value !== null && "type" in value && value.type === WALLET_UI_INPUT_MESSAGE.type;
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
