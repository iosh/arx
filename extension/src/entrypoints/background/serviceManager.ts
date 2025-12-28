import {
  ArxReasons,
  arxError,
  type BackgroundSessionServices,
  createBackgroundServices,
  createLogger,
  createNamespaceResolver,
  createPermissionScopeResolver,
  createRpcEngineForBackground,
  DEFAULT_NAMESPACE,
  extendLogger,
  type RpcInvocationContext,
} from "@arx/core";
import browser from "webextension-polyfill";
import { getExtensionChainRegistry, getExtensionKeyringStore, getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";
import { createPopupActivator } from "./services/popupActivator";
import type { ControllerSnapshot } from "./types";
import { createUiBridge } from "./uiBridge";
import { restoreUnlockState } from "./unlockRecovery";

export type BackgroundContext = {
  services: ReturnType<typeof createBackgroundServices>;
  controllers: ReturnType<typeof createBackgroundServices>["controllers"];
  engine: ReturnType<typeof createBackgroundServices>["engine"];
  session: BackgroundSessionServices;
};

type ServiceCallbacks = {
  broadcastEvent: (event: string, params: unknown[]) => void;
  broadcastDisconnect: () => void;
  syncAllPortContexts: (snapshot: ControllerSnapshot) => void;
};

type ServiceManagerDeps = {
  extensionOrigin: string;
  callbacks: ServiceCallbacks;
};

export const createServiceManager = ({ extensionOrigin, callbacks }: ServiceManagerDeps) => {
  let context: BackgroundContext | null = null;
  let contextPromise: Promise<BackgroundContext> | null = null;
  let uiBridge: ReturnType<typeof createUiBridge> | null = null;
  const unsubscribeControllerEvents: Array<() => void> = [];

  const runtimeLog = createLogger("bg:runtime");
  const sessionLog = extendLogger(runtimeLog, "session");

  const persistVaultMeta = async (target?: BackgroundContext | null) => {
    const active = target ?? context;
    if (!active) {
      console.warn("[background] persistVaultMeta called before context initialized");
      return;
    }

    try {
      await active.session.persistVaultMeta();
    } catch (error) {
      console.warn("[background] failed to persist vault meta", error);
    }
  };

  const getControllerSnapshot = (): ControllerSnapshot => {
    if (!context) throw new Error("Background context is not initialized");
    const { controllers, session } = context;
    const activeChain = controllers.network.getActiveChain();
    const networkState = controllers.network.getState();
    const active = controllers.accounts.getActivePointer();
    const isUnlocked = session.unlock.isUnlocked();
    const chainRef = active?.chainRef ?? activeChain.chainRef;
    const accounts = isUnlocked ? controllers.accounts.getAccounts({ chainRef }) : [];

    return {
      chain: { chainId: activeChain.chainId, caip2: activeChain.chainRef },
      accounts,
      isUnlocked,
      meta: {
        activeChain: activeChain.chainRef,
        activeNamespace: activeChain.namespace,
        supportedChains: networkState.knownChains.map((chain) => chain.chainRef),
      },
    };
  };

  const ensureContext = async (): Promise<BackgroundContext> => {
    if (context) {
      return context;
    }

    if (contextPromise) {
      return contextPromise;
    }

    contextPromise = (async () => {
      let resolveNamespaceRef: (ctx?: RpcInvocationContext) => string = () => DEFAULT_NAMESPACE;
      const namespaceResolver = (ctx?: RpcInvocationContext) => resolveNamespaceRef(ctx);
      const storage = getExtensionStorage();
      const chainRegistry = getExtensionChainRegistry();
      const keyringStore = getExtensionKeyringStore();
      const permissionScopeResolver = createPermissionScopeResolver(namespaceResolver);
      const services = createBackgroundServices({
        permissions: {
          scopeResolver: permissionScopeResolver,
        },
        storage: { port: storage, keyringStore },
        chainRegistry: { port: chainRegistry },
      });
      const { controllers, engine, messenger, session, keyring } = services;
      const popupActivator = createPopupActivator({ browser });
      const popupLog = extendLogger(runtimeLog, "popupActivator");
      const trackedPopupWindows = new Map<number, (removedId: number) => void>();

      /**
       * Reject all pending approvals with a 4001 userRejectedRequest error.
       * Used when the popup is closed or the session is locked to prevent hanging dApp requests.
       */
      const rejectAllPendingApprovals = (reason: string, details?: Record<string, unknown>) => {
        const pending = controllers.approvals.getState().pending;
        if (pending.length === 0) return;

        const snapshot = [...pending];
        for (const item of snapshot) {
          controllers.approvals.reject(
            item.id,
            arxError({
              reason: ArxReasons.ApprovalRejected,
              message: "User rejected the request.",
              data: { reason, id: item.id, origin: item.origin, type: item.type, ...details },
            }),
          );
        }
      };

      /**
       * Track popup windows and auto-reject approvals when a window is closed.
       * This matches common wallet behavior where closing the confirmation UI cancels pending requests.
       */
      const attachPopupCloseRejection = (windowId: number) => {
        if (trackedPopupWindows.has(windowId)) {
          return;
        }

        const onRemoved = (removedId: number) => {
          if (removedId !== windowId) return;
          browser.windows.onRemoved.removeListener(onRemoved);
          trackedPopupWindows.delete(windowId);
          rejectAllPendingApprovals("windowClosed", { windowId });
        };

        trackedPopupWindows.set(windowId, onRemoved);
        browser.windows.onRemoved.addListener(onRemoved);
      };

      const publishAccountsState = () => {
        const activePointer = controllers.accounts.getActivePointer();
        const fallbackChainRef = controllers.network.getActiveChain().chainRef;
        const chainRef = activePointer?.chainRef ?? fallbackChainRef;
        const accounts = session.unlock.isUnlocked() ? controllers.accounts.getAccounts({ chainRef }) : [];
        callbacks.broadcastEvent("accountsChanged", [accounts]);
      };

      await services.lifecycle.initialize();
      services.lifecycle.start();

      unsubscribeControllerEvents.push(() => {
        for (const [windowId, listener] of trackedPopupWindows.entries()) {
          browser.windows.onRemoved.removeListener(listener);
          trackedPopupWindows.delete(windowId);
        }
      });

      unsubscribeControllerEvents.push(
        messenger.subscribe("attention:requested", (request) => {
          popupLog("event:attention:requested", {
            reason: request.reason,
            origin: request.origin,
            method: request.method,
            chainRef: request.chainRef,
            namespace: request.namespace,
          });

          void popupActivator
            .open({
              reason: request.reason,
              origin: request.origin,
              method: request.method,
              chainRef: request.chainRef,
              namespace: request.namespace,
            })
            .then((result) => {
              if (result.windowId) {
                attachPopupCloseRejection(result.windowId);
              }
            })
            .catch((error) => {
              popupLog("failed to open popup", {
                error,
                reason: request.reason,
                origin: request.origin,
                method: request.method,
                chainRef: request.chainRef,
                namespace: request.namespace,
              });
            });
        }),
      );
      unsubscribeControllerEvents.push(
        messenger.subscribe("attention:stateChanged", (_state) => {
          uiBridge?.broadcast();
        }),
      );

      resolveNamespaceRef = createNamespaceResolver(controllers);

      unsubscribeControllerEvents.push(
        session.unlock.onUnlocked((payload) => {
          sessionLog("event:onUnlocked", { at: payload.at });
          callbacks.broadcastEvent("session:unlocked", [payload]);
          publishAccountsState();
        }),
      );
      unsubscribeControllerEvents.push(
        session.unlock.onLocked((payload) => {
          sessionLog("event:onLocked", { reason: payload.reason, at: payload.at });
          // Auto-reject all pending approvals when session is locked.
          rejectAllPendingApprovals("sessionLocked", { lockReason: payload.reason });
          callbacks.broadcastEvent("session:locked", [payload]);
          publishAccountsState();
          callbacks.broadcastDisconnect();
        }),
      );

      unsubscribeControllerEvents.push(
        controllers.network.onStateChanged(() => {
          const snapshot = getControllerSnapshot();
          callbacks.syncAllPortContexts(snapshot);
          callbacks.broadcastEvent("metaChanged", [snapshot.meta]);
        }),
      );

      const lastMeta = services.session.getLastPersistedVaultMeta();
      const persistedUnlockState = lastMeta?.payload.unlockState;
      if (persistedUnlockState) {
        restoreUnlockState({
          controller: session.unlock,
          snapshot: persistedUnlockState,
          snapshotCapturedAt: lastMeta.updatedAt,
          now: () => Date.now(),
        });
      }

      createRpcEngineForBackground(services, {
        isInternalOrigin: (origin) => isInternalOrigin(origin, extensionOrigin),
        shouldRequestUnlockAttention: () => true,
        shouldRequestApprovalAttention: () => true,
      });

      unsubscribeControllerEvents.push(
        controllers.network.onChainChanged(() => {
          const snapshot = getControllerSnapshot();
          callbacks.syncAllPortContexts(snapshot);
          callbacks.broadcastEvent("chainChanged", [
            {
              chainId: snapshot.chain.chainId,
              caip2: snapshot.chain.caip2,
              isUnlocked: snapshot.isUnlocked,
              meta: snapshot.meta,
            },
          ]);
        }),
      );
      unsubscribeControllerEvents.push(
        controllers.accounts.onStateChanged(() => {
          publishAccountsState();
        }),
      );

      context = { services, controllers, engine, session };

      uiBridge = createUiBridge({
        controllers,
        session,
        persistVaultMeta,
        keyring,
        attention: services.attention,
      });
      uiBridge.attachListeners();

      return context;
    })();

    try {
      return await contextPromise;
    } finally {
      contextPromise = null;
    }
  };

  const attachUiPort = async (port: browser.Runtime.Port) => {
    await ensureContext();
    uiBridge?.attachPort(port);
  };

  const destroy = () => {
    const toUnsubscribe = [...unsubscribeControllerEvents];
    unsubscribeControllerEvents.length = 0;
    for (const unsubscribe of toUnsubscribe) {
      unsubscribe();
    }

    uiBridge?.teardown();
    uiBridge = null;

    context?.services.lifecycle.destroy();
    context = null;
  };

  return {
    ensureContext,
    destroy,
    attachUiPort,
    persistVaultMeta,
    getControllerSnapshot,
  };
};
