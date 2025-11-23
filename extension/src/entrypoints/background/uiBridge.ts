import type { ApprovalTask, BackgroundSessionServices, HandlerControllers, UnlockReason } from "@arx/core";
import { ApprovalTypes } from "@arx/core";
import { type UiSnapshot, UiSnapshotSchema } from "@arx/core/ui";
import type browser from "webextension-polyfill";

export const UI_CHANNEL = "arx:ui" as const;

export type UiMessage =
  | { type: "ui:getSnapshot" }
  | { type: "ui:vaultInit"; payload: { password: string } }
  | { type: "ui:unlock"; payload: { password: string } }
  | { type: "ui:lock"; payload?: { reason?: UnlockReason } }
  | { type: "ui:resetAutoLockTimer" }
  | { type: "ui:switchAccount"; payload: { chainRef: string; address?: string | null } }
  | { type: "ui:switchChain"; payload: { chainRef: string } };

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

type BridgeDeps = {
  controllers: HandlerControllers;
  session: BackgroundSessionServices;
  persistVaultMeta: () => Promise<void>;
  now?: () => number;
};

type PortEnvelope =
  | { type: "ui:event"; event: "ui:stateChanged"; payload: UiSnapshot }
  | { type: "ui:response"; requestId: string; result: unknown }
  | { type: "ui:error"; requestId: string; error: { message: string; code?: number; data?: unknown } };

const normalizeError = (error: unknown): { message: string; code?: number; data?: unknown } => {
  if (error && typeof error === "object" && "message" in error) {
    const err = error as { message?: string; code?: number; data?: unknown };
    return { message: err.message ?? "Unknown error", code: err.code, data: err.data };
  }
  return { message: String(error ?? "Unknown error") };
};

const toUiWarning = (value: unknown): UiWarning => {
  if (value && typeof value === "object") {
    const entry = value as {
      code?: string;
      message?: string;
      level?: string;
      details?: Record<string, unknown>;
      data?: unknown;
    };
    return {
      code: entry.code ?? "UNKNOWN_WARNING",
      message: entry.message ?? "Unknown warning",
      level: entry.level === "info" || entry.level === "warning" || entry.level === "error" ? entry.level : undefined,
      details:
        entry.details ??
        (entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : undefined),
    };
  }
  return { code: "UNKNOWN_WARNING", message: String(value ?? "Unknown warning") };
};

const toUiIssue = (value: unknown): UiIssue => {
  if (value && typeof value === "object") {
    const entry = value as {
      code?: string;
      message?: string;
      severity?: string;
      details?: Record<string, unknown>;
      data?: unknown;
    };
    return {
      code: entry.code ?? "UNKNOWN_ISSUE",
      message: entry.message ?? "Unknown issue",
      severity:
        entry.severity === "low" || entry.severity === "medium" || entry.severity === "high"
          ? entry.severity
          : undefined,
      details:
        entry.details ??
        (entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : undefined),
    };
  }
  return { code: "UNKNOWN_ISSUE", message: String(value ?? "Unknown issue") };
};

export const createUiBridge = ({ controllers, session, persistVaultMeta, now = Date.now }: BridgeDeps) => {
  const ports = new Set<browser.Runtime.Port>();
  const listeners: Array<() => void> = [];
  const pendingTasks = new Map<string, ApprovalTask<unknown>>();

  const toApprovalSummary = (task: ApprovalTask<unknown>): UiSnapshot["approvals"][number] => {
    const base = {
      id: task.id,
      origin: task.origin,
      namespace: task.namespace ?? controllers.network.getActiveChain().namespace,
      chainRef: task.chainRef ?? controllers.network.getActiveChain().chainRef,
      createdAt: now(),
    };

    switch (task.type) {
      case ApprovalTypes.RequestAccounts:
        return {
          ...base,
          type: "requestAccounts",
          payload: {
            suggestedAccounts: Array.isArray((task.payload as { suggestedAccounts?: string[] })?.suggestedAccounts)
              ? ((task.payload as { suggestedAccounts?: string[] }).suggestedAccounts ?? [])
              : [],
          },
        };
      case ApprovalTypes.SignMessage:
        return {
          ...base,
          type: "signMessage",
          payload: {
            from: String((task.payload as { from?: string })?.from ?? ""),
            message: String((task.payload as { message?: string })?.message ?? ""),
          },
        };
      case ApprovalTypes.SignTypedData:
        return {
          ...base,
          type: "signTypedData",
          payload: {
            from: String((task.payload as { from?: string })?.from ?? ""),
            typedData:
              typeof (task.payload as { typedData?: string })?.typedData === "string"
                ? (task.payload as { typedData?: string }).typedData!
                : JSON.stringify((task.payload as { typedData?: unknown })?.typedData ?? {}),
          },
        };
      case ApprovalTypes.SendTransaction: {
        const txPayload = (task.payload as { request?: { payload?: Record<string, unknown> } })?.request?.payload ?? {};
        const rawWarnings = (task.payload as { warnings?: unknown[] })?.warnings ?? [];
        const rawIssues = (task.payload as { issues?: unknown[] })?.issues ?? [];
        return {
          ...base,
          type: "sendTransaction",
          payload: {
            from: String((task.payload as { from?: string })?.from ?? ""),
            to: typeof txPayload.to === "string" || txPayload.to === null ? (txPayload.to as string | null) : null,
            value: typeof txPayload.value === "string" ? (txPayload.value as string) : undefined,
            data: typeof txPayload.data === "string" ? (txPayload.data as string) : undefined,
            gas: typeof txPayload.gas === "string" ? (txPayload.gas as string) : undefined,
            fee: {
              gasPrice: typeof txPayload.gasPrice === "string" ? (txPayload.gasPrice as string) : undefined,
              maxFeePerGas: typeof txPayload.maxFeePerGas === "string" ? (txPayload.maxFeePerGas as string) : undefined,
              maxPriorityFeePerGas:
                typeof txPayload.maxPriorityFeePerGas === "string"
                  ? (txPayload.maxPriorityFeePerGas as string)
                  : undefined,
            },
            summary: (task.payload as { draft?: { summary?: Record<string, unknown> } })?.draft?.summary,
            warnings: rawWarnings.map(toUiWarning),
            issues: rawIssues.map(toUiIssue),
          },
        };
      }
      default:
        throw new Error(`Unsupported approval type: ${task.type}`);
    }
  };

  const buildSnapshot = (): UiSnapshot => {
    const chain = controllers.network.getActiveChain();
    const networkState = controllers.network.getState();
    const activePointer = controllers.accounts.getActivePointer();
    const resolvedChain = activePointer?.chainRef ?? chain.chainRef;
    const accountList = session.unlock.isUnlocked()
      ? controllers.accounts.getAccounts({ chainRef: resolvedChain })
      : [];

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
        list: accountList,
        active: activePointer?.address ?? null,
      },
      session: {
        isUnlocked: session.unlock.isUnlocked(),
        autoLockDurationMs: session.unlock.getState().timeoutMs,
        nextAutoLockAt: session.unlock.getState().nextAutoLockAt,
      },
      approvals: Array.from(pendingTasks.values()).map(toApprovalSummary),
      permissions: controllers.permissions.getState(),
      vault: {
        initialized: session.vault.getStatus().hasCiphertext,
      },
    };

    return UiSnapshotSchema.parse(snapshot);
  };

  const broadcast = () => {
    let snapshot: UiSnapshot;
    try {
      snapshot = buildSnapshot();
    } catch (error) {
      console.warn("[uiBridge] failed to build snapshot", error);
      return;
    }
    for (const port of ports) {
      const envelope: PortEnvelope = { type: "ui:event", event: "ui:stateChanged", payload: snapshot };
      port.postMessage(envelope);
    }
  };

  const handleMessage = async (message: UiMessage) => {
    switch (message.type) {
      case "ui:getSnapshot":
        return buildSnapshot();
      case "ui:vaultInit": {
        const ciphertext = await session.vault.initialize({ password: message.payload.password });
        await persistVaultMeta();
        broadcast();
        return { ciphertext };
      }
      case "ui:unlock": {
        await session.unlock.unlock({ password: message.payload.password });
        await persistVaultMeta();
        broadcast();
        return session.unlock.getState();
      }
      case "ui:lock": {
        session.unlock.lock(message.payload?.reason ?? "manual");
        await persistVaultMeta();
        broadcast();
        return session.unlock.getState();
      }
      case "ui:resetAutoLockTimer": {
        session.unlock.scheduleAutoLock();
        await persistVaultMeta();
        broadcast();
        return session.unlock.getState();
      }
      case "ui:switchAccount": {
        await controllers.accounts.switchActive({
          chainRef: message.payload.chainRef,
          address: message.payload.address ?? null,
        });
        broadcast();
        return buildSnapshot().accounts.active;
      }
      case "ui:switchChain": {
        await controllers.network.switchChain(message.payload.chainRef);
        broadcast();
        return buildSnapshot().chain;
      }
      default:
        return undefined;
    }
  };

  const attachPort = (port: browser.Runtime.Port) => {
    ports.add(port);

    const onMessage = async (raw: unknown) => {
      const envelope = raw as { type?: string; requestId?: string; payload?: UiMessage };
      if (!envelope || envelope.type !== "ui:request" || !envelope.requestId || !envelope.payload) {
        return;
      }
      try {
        const result = await handleMessage(envelope.payload);
        const response: PortEnvelope = { type: "ui:response", requestId: envelope.requestId, result };
        port.postMessage(response);
      } catch (error) {
        const failure: PortEnvelope = {
          type: "ui:error",
          requestId: envelope.requestId,
          error: normalizeError(error),
        };
        port.postMessage(failure);
      }
    };

    const onDisconnect = () => {
      ports.delete(port);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ type: "ui:event", event: "ui:stateChanged", payload: buildSnapshot() } satisfies PortEnvelope);
  };

  const attachListeners = () => {
    listeners.push(
      controllers.accounts.onStateChanged(() => broadcast()),
      controllers.network.onStateChanged(() => broadcast()),
      controllers.approvals.onRequest((task: ApprovalTask<unknown>) => {
        pendingTasks.set(task.id, task);
        broadcast();
      }),
      controllers.approvals.onFinish((result: { id: string }) => {
        pendingTasks.delete(result.id);
        broadcast();
      }),
      controllers.approvals.onStateChanged(() => broadcast()),
      session.unlock.onStateChanged(() => broadcast()),
    );
  };

  const teardown = () => {
    listeners.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.warn("[uiBridge] failed to remove listener", error);
      }
    });
    ports.clear();
    pendingTasks.clear();
  };

  return {
    attachPort,
    handleMessage,
    attachListeners,
    broadcast,
    teardown,
  };
};
