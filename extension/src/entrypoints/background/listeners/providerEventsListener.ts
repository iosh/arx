import { PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { createPortRouter } from "../portRouter";
import type { BackgroundRuntimeHost } from "../runtimeHost";

type ProviderEventsOrchestratorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  portRouter: ReturnType<typeof createPortRouter>;
};

export const createProviderEventsListener = ({ runtimeHost, portRouter }: ProviderEventsOrchestratorDeps) => {
  const subscriptions: Array<() => void> = [];
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;

  const start = () => {
    if (started) return;
    started = true;
    disposed = false;

    if (startTask) return;

    startTask = (async () => {
      const { controllers, session } = await runtimeHost.getOrInitContext();
      if (disposed) return;

      const publishAccountsState = () => {
        portRouter.broadcastEvent(PROVIDER_EVENTS.accountsChanged, []);
      };

      subscriptions.push(
        session.unlock.onUnlocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
          publishAccountsState();
        }),
      );

      subscriptions.push(
        session.unlock.onLocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
          publishAccountsState();
          portRouter.broadcastDisconnect();
        }),
      );

      subscriptions.push(
        controllers.network.onStateChanged(() => {
          const snapshot = runtimeHost.getControllerSnapshot();
          portRouter.syncAllPortContexts(snapshot);
          portRouter.broadcastEvent(PROVIDER_EVENTS.metaChanged, [snapshot.meta]);
        }),
      );

      subscriptions.push(
        controllers.network.onActiveChainChanged(() => {
          const snapshot = runtimeHost.getControllerSnapshot();
          portRouter.syncAllPortContexts(snapshot);
          portRouter.broadcastEvent(PROVIDER_EVENTS.chainChanged, [
            {
              chainId: snapshot.chain.chainId,
              chainRef: snapshot.chain.chainRef,
              isUnlocked: snapshot.isUnlocked,
              meta: snapshot.meta,
            },
          ]);
        }),
      );

      subscriptions.push(
        controllers.accounts.onStateChanged(() => {
          publishAccountsState();
        }),
      );

      subscriptions.push(
        controllers.permissions.onPermissionsChanged(() => {
          publishAccountsState();
        }),
      );
    })().finally(() => {
      startTask = null;
    });
  };

  const destroy = () => {
    started = false;
    disposed = true;
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    });
  };

  return { start, destroy };
};
