import type { WalletApiContext } from "../context.js";

export const getWalletSnapshot = (context: WalletApiContext) => context.snapshots.buildUiSnapshot();

const subscribeAfterInitialReplay = (subscribe: (listener: () => void) => () => void, listener: () => void) => {
  let replayingSnapshot = true;
  const unsubscribe = subscribe(() => {
    if (replayingSnapshot) {
      return;
    }
    listener();
  });
  replayingSnapshot = false;
  return unsubscribe;
};

export const subscribeWalletSnapshot = (context: WalletApiContext, listener: () => void) => {
  const unsubscribers = context.snapshotChangeSources.map((subscribe) =>
    subscribeAfterInitialReplay(subscribe, listener),
  );
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
};
