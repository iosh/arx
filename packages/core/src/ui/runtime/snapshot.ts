import type { ChainMetadata } from "../../chains/metadata.js";
import type { ApprovalTask } from "../../controllers/approval/types.js";
import { ApprovalTypes } from "../../controllers/approval/types.js";
import type { RequestPermissionsApprovalPayload } from "../../controllers/permission/types.js";
import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import { type UiSnapshot, UiSnapshotSchema } from "../schemas.js";

type UiWarning = {
  code: string;
  message: string;
  level?: "info" | "warning" | "error";
  details?: Record<string, unknown>;
};

type UiIssue = {
  code: string;
  message: string;
  severity?: "low" | "medium" | "high";
  details?: Record<string, unknown>;
};

const toDetails = (entry: { details?: unknown; data?: unknown }): Record<string, unknown> | undefined => {
  if (entry.details && typeof entry.details === "object") return entry.details as Record<string, unknown>;
  if (entry.data && typeof entry.data === "object") return entry.data as Record<string, unknown>;
  return undefined;
};

const toUiWarning = (value: unknown): UiWarning => {
  if (value && typeof value === "object") {
    const entry = value as {
      code?: unknown;
      message?: unknown;
      severity?: unknown;
      details?: unknown;
      data?: unknown;
    };

    const level =
      entry.severity === "low"
        ? "info"
        : entry.severity === "medium"
          ? "warning"
          : entry.severity === "high"
            ? "error"
            : undefined;

    const out: UiWarning = {
      code: typeof entry.code === "string" ? entry.code : "UNKNOWN_WARNING",
      message: typeof entry.message === "string" ? entry.message : "Unknown warning",
    };
    if (level) out.level = level;
    const details = toDetails(entry);
    if (details) out.details = details;
    return out;
  }

  return { code: "UNKNOWN_WARNING", message: String(value ?? "Unknown warning") };
};

const toUiIssue = (value: unknown): UiIssue => {
  if (value && typeof value === "object") {
    const entry = value as { code?: unknown; message?: unknown; severity?: unknown; details?: unknown; data?: unknown };
    const severity =
      entry.severity === "low" || entry.severity === "medium" || entry.severity === "high"
        ? (entry.severity as UiIssue["severity"])
        : undefined;

    const out: UiIssue = {
      code: typeof entry.code === "string" ? entry.code : "UNKNOWN_ISSUE",
      message: typeof entry.message === "string" ? entry.message : "Unknown issue",
    };
    if (severity) out.severity = severity;
    const details = toDetails(entry);
    if (details) out.details = details;
    return out;
  }

  return { code: "UNKNOWN_ISSUE", message: String(value ?? "Unknown issue") };
};

type RequestAccountsPayload = { suggestedAccounts?: string[] };
type SignMessagePayload = { from?: string; message?: string };
type SignTypedDataPayload = { from?: string; typedData?: string | unknown };
type SendTransactionPayload = {
  from?: string;
  request?: { payload?: Record<string, unknown> };
  warnings?: unknown[];
  issues?: unknown[];
};
type AddChainPayload = { metadata: ChainMetadata; isUpdate: boolean };

const extractPayload = <T>(payload: unknown): T => payload as T;

const toApprovalSummary = (
  controllers: HandlerControllers,
  task: ApprovalTask<unknown>,
): UiSnapshot["approvals"][number] => {
  const activeChain = controllers.network.getActiveChain();
  const base = {
    id: task.id,
    origin: task.origin,
    namespace: task.namespace ?? activeChain.namespace,
    chainRef: task.chainRef ?? activeChain.chainRef,
    createdAt: task.createdAt,
  };

  switch (task.type) {
    case ApprovalTypes.RequestAccounts: {
      const payload = extractPayload<RequestAccountsPayload>(task.payload);
      const suggestedAccounts = Array.isArray(payload.suggestedAccounts)
        ? payload.suggestedAccounts.map((value) => String(value))
        : [];

      return {
        ...base,
        type: "requestAccounts",
        payload: { suggestedAccounts },
      };
    }
    case ApprovalTypes.SignMessage: {
      const payload = extractPayload<SignMessagePayload>(task.payload);
      return {
        ...base,
        type: "signMessage",
        payload: {
          from: String(payload.from ?? ""),
          message: String(payload.message ?? ""),
        },
      };
    }
    case ApprovalTypes.SignTypedData: {
      const payload = extractPayload<SignTypedDataPayload>(task.payload);
      return {
        ...base,
        type: "signTypedData",
        payload: {
          from: String(payload.from ?? ""),
          typedData:
            typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData ?? {}),
        },
      };
    }
    case ApprovalTypes.RequestPermissions: {
      const payload = extractPayload<RequestPermissionsApprovalPayload>(task.payload);
      return {
        ...base,
        type: "requestPermissions",
        payload: {
          permissions: payload.requested.map((item) => ({
            capability: item.capability,
            scope: item.scope,
            chains: [...item.chains],
          })),
        },
      };
    }
    case ApprovalTypes.SendTransaction: {
      const payload = extractPayload<SendTransactionPayload>(task.payload);
      const txMeta = controllers.transactions.getMeta(task.id);
      const txPayload =
        (txMeta?.request?.payload as Record<string, unknown> | undefined) ?? payload.request?.payload ?? {};

      const prepared =
        txMeta?.prepared && typeof txMeta.prepared === "object" ? (txMeta.prepared as Record<string, unknown>) : null;

      const warningsSource = txMeta?.warnings ?? payload.warnings ?? [];
      const issuesSource = txMeta?.issues ?? payload.issues ?? [];

      return {
        ...base,
        type: "sendTransaction",
        payload: {
          from: String(txMeta?.from ?? payload.from ?? ""),
          to: typeof txPayload.to === "string" || txPayload.to === null ? (txPayload.to as string | null) : null,
          value: typeof txPayload.value === "string" ? txPayload.value : undefined,
          data: typeof txPayload.data === "string" ? txPayload.data : undefined,
          gas:
            prepared && typeof prepared.gas === "string"
              ? prepared.gas
              : typeof txPayload.gas === "string"
                ? txPayload.gas
                : undefined,
          fee: {
            gasPrice:
              prepared && typeof prepared.gasPrice === "string"
                ? prepared.gasPrice
                : typeof txPayload.gasPrice === "string"
                  ? txPayload.gasPrice
                  : undefined,
            maxFeePerGas:
              prepared && typeof prepared.maxFeePerGas === "string"
                ? prepared.maxFeePerGas
                : typeof txPayload.maxFeePerGas === "string"
                  ? txPayload.maxFeePerGas
                  : undefined,
            maxPriorityFeePerGas:
              prepared && typeof prepared.maxPriorityFeePerGas === "string"
                ? prepared.maxPriorityFeePerGas
                : typeof txPayload.maxPriorityFeePerGas === "string"
                  ? txPayload.maxPriorityFeePerGas
                  : undefined,
          },
          warnings: warningsSource.map(toUiWarning),
          issues: issuesSource.map(toUiIssue),
        },
      };
    }
    case ApprovalTypes.AddChain: {
      const payload = extractPayload<AddChainPayload>(task.payload);
      const meta = payload.metadata;
      const rpcUrls = Array.from(new Set(meta.rpcEndpoints.map((ep) => ep.url.trim()).filter(Boolean)));
      const blockExplorerUrl =
        meta.blockExplorers?.find((entry) => entry.type === "default")?.url ?? meta.blockExplorers?.[0]?.url;
      return {
        ...base,
        type: "addChain",
        payload: {
          chainRef: meta.chainRef,
          chainId: meta.chainId,
          displayName: meta.displayName,
          rpcUrls,
          nativeCurrency: meta.nativeCurrency
            ? {
                name: meta.nativeCurrency.name,
                symbol: meta.nativeCurrency.symbol,
                decimals: meta.nativeCurrency.decimals,
              }
            : undefined,
          blockExplorerUrl,
          isUpdate: payload.isUpdate,
        },
      };
    }
    default:
      throw new Error(`Unsupported approval type: ${task.type}`);
  }
};

export const buildUiSnapshot = (deps: {
  controllers: HandlerControllers;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: { getSnapshot: () => UiSnapshot["attention"] };
}): UiSnapshot => {
  const { controllers, session, keyring, attention } = deps;

  const chain = controllers.network.getActiveChain();
  const networkState = controllers.network.getState();
  const activePointer = controllers.accounts.getActivePointer();
  const resolvedChain = activePointer?.chainRef ?? chain.chainRef;

  const accountList = session.unlock.isUnlocked() ? controllers.accounts.getAccounts({ chainRef: resolvedChain }) : [];

  const accountsState = controllers.accounts.getState();
  const totalCount = Object.values(accountsState.namespaces).reduce((sum, ns) => sum + ns.all.length, 0);

  const approvalState = controllers.approvals.getState();
  const approvalSummaries = approvalState.pending
    .map((item) => {
      const task = controllers.approvals.get(item.id);
      return task ? toApprovalSummary(controllers, task) : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const keyringWarnings = keyring
    .getKeyrings()
    .filter((meta) => meta.type === "hd" && meta.needsBackup === true)
    .map((meta) => ({
      keyringId: meta.id,
      alias: meta.name ?? null,
    }));

  const snapshot: UiSnapshot = {
    chain: {
      chainRef: chain.chainRef,
      chainId: chain.chainId,
      namespace: chain.namespace,
      displayName: chain.displayName,
      shortName: chain.shortName ?? null,
      icon: chain.icon?.url ?? null,
    },
    networks: {
      active: networkState.activeChain,
      known: networkState.knownChains.map((metadata) => ({
        chainRef: metadata.chainRef,
        chainId: metadata.chainId,
        namespace: metadata.namespace,
        displayName: metadata.displayName,
        shortName: metadata.shortName ?? null,
        icon: metadata.icon?.url ?? null,
      })),
    },
    accounts: {
      totalCount,
      list: accountList,
      active: activePointer?.address ?? null,
    },
    session: {
      isUnlocked: session.unlock.isUnlocked(),
      autoLockDurationMs: session.unlock.getState().timeoutMs,
      nextAutoLockAt: session.unlock.getState().nextAutoLockAt,
    },
    approvals: approvalSummaries,
    attention: attention.getSnapshot(),
    permissions: controllers.permissions.getState(),
    vault: {
      initialized: session.vault.getStatus().hasCiphertext,
    },
    warnings: {
      hdKeyringsNeedingBackup: keyringWarnings,
    },
  };

  return UiSnapshotSchema.parse(snapshot);
};
