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

type DiagnosticEntry<T extends string> = {
  code: string;
  message: string;
  level?: T;
  details?: Record<string, unknown>;
};

const toDiagnostic = <T extends string>(
  value: unknown,
  levelKey: "level" | "severity",
  validLevels: readonly T[],
  defaultCode: string,
  defaultMessage: string,
): DiagnosticEntry<T> => {
  if (value && typeof value === "object") {
    const entry = value as {
      code?: string;
      message?: string;
      level?: string;
      severity?: string;
      details?: Record<string, unknown>;
      data?: unknown;
    };

    const levelValue = levelKey === "level" ? entry.level : entry.severity;
    const validLevel = validLevels.includes(levelValue as T) ? (levelValue as T) : undefined;

    return {
      code: entry.code ?? defaultCode,
      message: entry.message ?? defaultMessage,
      [levelKey]: validLevel,
      details:
        entry.details ??
        (entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : undefined),
    } as DiagnosticEntry<T>;
  }

  return {
    code: defaultCode,
    message: String(value ?? defaultMessage),
  } as DiagnosticEntry<T>;
};

const toUiWarning = (value: unknown): UiWarning => {
  return toDiagnostic(
    value,
    "level",
    ["info", "warning", "error"] as const,
    "UNKNOWN_WARNING",
    "Unknown warning",
  ) as UiWarning;
};

const toUiIssue = (value: unknown): UiIssue => {
  return toDiagnostic(
    value,
    "severity",
    ["low", "medium", "high"] as const,
    "UNKNOWN_ISSUE",
    "Unknown issue",
  ) as UiIssue;
};

type RequestAccountsPayload = { suggestedAccounts?: string[] };
type SignMessagePayload = { from?: string; message?: string };
type SignTypedDataPayload = { from?: string; typedData?: string | unknown };
type SendTransactionPayload = {
  from?: string;
  request?: { payload?: Record<string, unknown> };
  warnings?: unknown[];
  issues?: unknown[];
  draft?: { summary?: Record<string, unknown> };
};

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
          typedData: typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData ?? {}),
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
      const txPayload = payload.request?.payload ?? {};

      return {
        ...base,
        type: "sendTransaction",
        payload: {
          from: String(payload.from ?? ""),
          to: typeof txPayload.to === "string" || txPayload.to === null ? (txPayload.to as string | null) : null,
          value: typeof txPayload.value === "string" ? txPayload.value : undefined,
          data: typeof txPayload.data === "string" ? txPayload.data : undefined,
          gas: typeof txPayload.gas === "string" ? txPayload.gas : undefined,
          fee: {
            gasPrice: typeof txPayload.gasPrice === "string" ? txPayload.gasPrice : undefined,
            maxFeePerGas: typeof txPayload.maxFeePerGas === "string" ? txPayload.maxFeePerGas : undefined,
            maxPriorityFeePerGas:
              typeof txPayload.maxPriorityFeePerGas === "string" ? txPayload.maxPriorityFeePerGas : undefined,
          },
          summary: payload.draft?.summary,
          warnings: (payload.warnings ?? []).map(toUiWarning),
          issues: (payload.issues ?? []).map(toUiIssue),
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
    .filter((meta) => meta.type === "hd" && !meta.backedUp)
    .map((meta) => ({
      keyringId: meta.id,
      alias: meta.alias ?? null,
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

