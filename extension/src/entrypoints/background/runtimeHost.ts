import {
  ApprovalKinds,
  type ApprovalKind,
  type ApprovalRequester,
  type ApprovalTerminalReason,
} from "@arx/core/controllers/approval";
import { type ApprovalDetail, createArxWalletRuntime, type WalletProvider } from "@arx/core/engine";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import type { UiPlatformAdapter, UiRuntimeAccess } from "@arx/core/runtime";
import { ATTENTION_REQUESTED, type AttentionRequest } from "@arx/core/services";
import { buildTransactionTerminalReason } from "@arx/core/transactions";
import browser from "webextension-polyfill";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";
import { createUiActivationExtension, type UiActivationEntries } from "./ui/uiActivationExtension";

type BackgroundRuntimeCache = {
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>;
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getOrInitProvider: () => Promise<WalletProvider>;
  getOrInitUiAccess: (params: BackgroundUiAccessParams) => Promise<UiRuntimeAccess>;
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
  shutdown: () => Promise<void>;
  applyDebugNamespacesFromEnv: () => void;
};

export type BackgroundUiAccessParams = {
  platform: UiPlatformAdapter;
  activation: UiActivationEntries;
  uiOrigin: string;
};

type BackgroundRuntime = Awaited<ReturnType<typeof createArxWalletRuntime>>;
type BackgroundRuntimeApprovals = BackgroundRuntime["controllers"]["approvals"];
type BackgroundRuntimeTransactions = BackgroundRuntime["transactions"];
type BackgroundRuntimeUnlock = BackgroundRuntime["services"]["session"]["unlock"];

type RuntimeApprovalCreatedEvent = Parameters<Parameters<BackgroundRuntimeApprovals["onCreated"]>[0]>[0];
type ApprovalSessionLockedListener = Parameters<BackgroundRuntimeUnlock["onLocked"]>[0];
type RuntimeTransactionApproval = NonNullable<ReturnType<BackgroundRuntimeTransactions["getTransactionApproval"]>>;

export type BackgroundApprovalEntry = {
  approvalId: string;
  kind: ApprovalKind;
  origin: string;
  namespace: string;
  chainRef: string;
  createdAt: number;
  requester: ApprovalRequester;
};

export type BackgroundApprovalCreatedEvent = {
  approval: BackgroundApprovalEntry;
};

export type BackgroundApprovalFinishedEvent = {
  approvalId: string;
};

export type BackgroundUnlockAttentionRequestedPayload = AttentionRequest & { reason: "unlock_required" };

export type BackgroundUiEntryAccess = {
  subscribeUnlockAttentionRequested: (
    listener: (payload: BackgroundUnlockAttentionRequestedPayload) => void,
  ) => () => void;
  subscribeApprovalCreated: (listener: (event: BackgroundApprovalCreatedEvent) => void) => () => void;
  subscribeApprovalFinished: (listener: (event: BackgroundApprovalFinishedEvent) => void) => () => void;
  subscribeApprovalStateChanged: (listener: () => void) => () => void;
  subscribeSessionLocked: (listener: ApprovalSessionLockedListener) => () => void;
  cancelApproval: (params: { approvalId: string; reason: ApprovalTerminalReason }) => Promise<void>;
  cancelPendingApprovals: (reason: ApprovalTerminalReason) => Promise<void>;
  getPendingApprovalCount: () => Promise<number>;
  getApprovalDetail: (approvalId: string) => Promise<ApprovalDetail | null>;
  hasInitializedVault: () => boolean;
};

const isUnlockAttentionRequest = (payload: AttentionRequest): payload is BackgroundUnlockAttentionRequestedPayload => {
  return payload.reason === "unlock_required";
};

const toGenericApprovalEntry = (record: RuntimeApprovalCreatedEvent["record"]): BackgroundApprovalEntry => ({
  approvalId: record.approvalId,
  kind: record.kind,
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  createdAt: record.createdAt,
  requester: record.requester,
});

const buildTransactionApprovalCancelReason = (reason: ApprovalTerminalReason) =>
  buildTransactionTerminalReason({
    kind: "approval_cancelled",
    code: `ui.${reason}`,
    message:
      reason === "user_dismissed"
        ? "User dismissed the transaction approval window."
        : "Transaction approval was cancelled by the UI.",
    details: { reason },
  });

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let provider: WalletProvider | null = null;
  let uiAccess: UiRuntimeAccess | null = null;
  let uiAccessPromise: Promise<UiRuntimeAccess> | null = null;
  let uiAccessParams: BackgroundUiAccessParams | null = null;
  let runtimeGeneration = 0;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const applyDebugNamespacesFromEnv = () => {
    const raw: unknown = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_ARX_DEBUG_NAMESPACES;
    const namespaces = typeof raw === "string" ? raw.trim() : "";

    if (!namespaces) {
      disableDebugNamespaces();
      return;
    }

    enableDebugNamespaces(namespaces);
  };

  const initializeRuntime = async () => {
    await getOrInitRuntimeCache();
  };

  const getOrInitRuntimeCache = async (): Promise<BackgroundRuntimeCache> => {
    if (runtimeCache) return runtimeCache;
    if (runtimeCachePromise) return runtimeCachePromise;

    const bootGeneration = runtimeGeneration;

    runtimeCachePromise = (async () => {
      const storage = getExtensionStorage();
      const runtime = await createArxWalletRuntime({
        namespaces: INSTALLED_NAMESPACES.engine,
        storage: {
          ports: {
            accounts: storage.ports.accounts,
            customChains: storage.ports.customChains,
            customRpc: storage.ports.customRpc,
            keyringMetas: storage.ports.keyringMetas,
            networkSelection: storage.ports.networkSelection,
            permissions: storage.ports.permissions,
            transactionAggregates: storage.ports.transactionAggregates,
            settings: storage.ports.settings,
          },
          vaultMetaPort: storage.ports.vaultMeta,
        },
        runtime: {
          lifecycleLabel: "createBackgroundRuntimeHost",
          rpcEngine: {
            env: {
              isInternalOrigin: (origin) => isInternalOrigin(origin, deps.extensionOrigin),
              shouldRequestUnlockAttention: () => true,
            },
          },
        },
      });

      if (bootGeneration !== runtimeGeneration) {
        await runtime.shutdown();
        throw new Error("Background runtime host was reset during boot");
      }

      const next: BackgroundRuntimeCache = { runtime };

      runtimeCache = next;
      hostLog("runtime initialized", { runtimeId: browser.runtime.id });
      return next;
    })();

    try {
      return await runtimeCachePromise;
    } finally {
      runtimeCachePromise = null;
    }
  };

  const assertUiAccessParamsMatch = (next: BackgroundUiAccessParams) => {
    if (!uiAccessParams) return;
    if (
      uiAccessParams.platform === next.platform &&
      uiAccessParams.activation === next.activation &&
      uiAccessParams.uiOrigin === next.uiOrigin
    ) {
      return;
    }

    throw new Error("Background runtime host UI access parameters must remain stable across calls");
  };

  const getOrInitUiAccess = async ({
    platform,
    activation,
    uiOrigin,
  }: BackgroundUiAccessParams): Promise<UiRuntimeAccess> => {
    assertUiAccessParamsMatch({ platform, activation, uiOrigin });
    if (uiAccess) return uiAccess;
    if (uiAccessPromise) return await uiAccessPromise;
    uiAccessParams = { platform, activation, uiOrigin };
    const accessGeneration = runtimeGeneration;

    uiAccessPromise = (async () => {
      const active = await getOrInitRuntimeCache();
      const access = active.runtime.createUiAccess({
        platform,
        uiOrigin,
        extensions: [createUiActivationExtension({ entries: activation })],
      });

      if (accessGeneration !== runtimeGeneration) {
        throw new Error("Background runtime host was reset during UI access bootstrap");
      }

      uiAccess = access;
      return access;
    })();

    try {
      return await uiAccessPromise;
    } catch (error) {
      uiAccessParams = null;
      throw error;
    } finally {
      uiAccessPromise = null;
    }
  };

  const getOrInitProvider = async (): Promise<WalletProvider> => {
    if (provider) {
      return provider;
    }

    const providerGeneration = runtimeGeneration;
    const active = await getOrInitRuntimeCache();
    if (providerGeneration !== runtimeGeneration) {
      throw new Error("Background runtime host was reset during provider bootstrap");
    }

    provider = active.runtime.wallet.createProvider();
    return provider;
  };

  const getOrInitUiEntryAccess = async (): Promise<BackgroundUiEntryAccess> => {
    const active = await getOrInitRuntimeCache();

    const buildTransactionApprovalEntry = async (
      approval: RuntimeTransactionApproval,
    ): Promise<BackgroundApprovalEntry | null> => {
      const transaction = await active.runtime.transactions.getTransaction(approval.transactionId);
      if (!transaction) {
        return null;
      }

      return {
        approvalId: approval.approvalId,
        kind: ApprovalKinds.SendTransaction,
        origin: approval.origin,
        namespace: approval.namespace,
        chainRef: approval.chainRef,
        createdAt: approval.createdAt,
        requester: {
          origin: approval.origin,
          initiator: transaction.source === "wallet" ? "wallet_ui" : "dapp",
        },
      };
    };

    const cancelApproval = async ({ approvalId, reason }: { approvalId: string; reason: ApprovalTerminalReason }) => {
      const transaction = await active.runtime.transactions.cancelTransactionApproval({
        approvalId,
        reason: buildTransactionApprovalCancelReason(reason),
      });
      if (transaction) {
        return;
      }

      await active.runtime.controllers.approvals.cancel({ approvalId, reason });
    };

    return {
      subscribeUnlockAttentionRequested: (listener) =>
        active.runtime.bus.subscribe(ATTENTION_REQUESTED, (payload) => {
          if (!isUnlockAttentionRequest(payload)) {
            return;
          }

          listener(payload);
        }),
      subscribeApprovalCreated: (listener) => {
        const unsubscribeGeneric = active.runtime.controllers.approvals.onCreated((event) => {
          listener({ approval: toGenericApprovalEntry(event.record) });
        });
        const createdTransactionApprovalIds = new Set<string>();
        const unsubscribeTransactions = active.runtime.transactions.onTransactionApprovalsChanged((approvalIds) => {
          for (const approvalId of approvalIds) {
            const approval = active.runtime.transactions.getTransactionApproval(approvalId);
            if (!approval) {
              createdTransactionApprovalIds.delete(approvalId);
              continue;
            }
            if (createdTransactionApprovalIds.has(approvalId)) {
              continue;
            }

            createdTransactionApprovalIds.add(approvalId);
            void buildTransactionApprovalEntry(approval)
              .then((entry) => {
                if (entry && createdTransactionApprovalIds.has(approvalId)) {
                  listener({ approval: entry });
                  return;
                }
                createdTransactionApprovalIds.delete(approvalId);
              })
              .catch((error) => {
                createdTransactionApprovalIds.delete(approvalId);
                hostLog("failed to build transaction approval entry", { approvalId, error });
              });
          }
        });

        return () => {
          unsubscribeGeneric();
          unsubscribeTransactions();
        };
      },
      subscribeApprovalFinished: (listener) => {
        const unsubscribeGeneric = active.runtime.controllers.approvals.onFinished((event) => {
          listener({ approvalId: event.approvalId });
        });
        const activeTransactionApprovalIds = new Set<string>();
        const unsubscribeTransactions = active.runtime.transactions.onTransactionApprovalsChanged((approvalIds) => {
          for (const approvalId of approvalIds) {
            const approval = active.runtime.transactions.getTransactionApproval(approvalId);
            if (approval) {
              activeTransactionApprovalIds.add(approvalId);
              continue;
            }

            if (!activeTransactionApprovalIds.delete(approvalId)) {
              continue;
            }

            listener({ approvalId });
          }
        });

        return () => {
          unsubscribeGeneric();
          unsubscribeTransactions();
        };
      },
      subscribeApprovalStateChanged: (listener) => {
        const unsubscribeGeneric = active.runtime.controllers.approvals.onStateChanged(() => listener());
        const unsubscribeTransactions = active.runtime.transactions.onTransactionApprovalsChanged(() => listener());

        return () => {
          unsubscribeGeneric();
          unsubscribeTransactions();
        };
      },
      subscribeSessionLocked: (listener) => active.runtime.services.session.unlock.onLocked(listener),
      cancelApproval,
      cancelPendingApprovals: async (reason) => {
        const genericApprovalIds = active.runtime.controllers.approvals.getState().pending.map((item) => item.approvalId);
        const transactionApprovalIds = (await active.runtime.transactions.listTransactionApprovals()).map(
          (approval) => approval.approvalId,
        );
        const approvalIds = Array.from(new Set([...genericApprovalIds, ...transactionApprovalIds]));
        await Promise.all(approvalIds.map((approvalId) => cancelApproval({ approvalId, reason })));
      },
      getPendingApprovalCount: async () =>
        active.runtime.controllers.approvals.getState().pending.length +
        (await active.runtime.transactions.listTransactionApprovals()).length,
      getApprovalDetail: (approvalId) => active.runtime.getApprovalDetail(approvalId),
      hasInitializedVault: () => active.runtime.services.sessionStatus.hasInitializedVault(),
    };
  };

  const shutdown = async () => {
    runtimeGeneration += 1;
    provider = null;
    uiAccess = null;
    uiAccessParams = null;
    const activeRuntime = runtimeCache?.runtime ?? null;
    const pendingRuntimeCachePromise = runtimeCachePromise;
    runtimeCache = null;
    runtimeCachePromise = null;

    if (activeRuntime) {
      await activeRuntime.shutdown();
      return;
    }

    if (!pendingRuntimeCachePromise) {
      return;
    }

    try {
      await pendingRuntimeCachePromise;
    } catch {
      // Boot failed or was interrupted while shutting down. Nothing else to do.
    } finally {
      runtimeCache = null;
    }
  };

  return {
    initializeRuntime,
    getOrInitProvider,
    getOrInitUiAccess,
    getOrInitUiEntryAccess,
    shutdown,
    applyDebugNamespacesFromEnv,
  };
};
