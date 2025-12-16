import type {
  ApprovalTask,
  AttentionService,
  BackgroundSessionServices,
  HandlerControllers,
  KeyringService,
  RequestPermissionsApprovalPayload,
} from "@arx/core";
import { ApprovalTypes, createLogger, getProviderErrors, PermissionScopes, zeroize } from "@arx/core";
import { type UiMessage, type UiPortEnvelope, type UiSnapshot, UiSnapshotSchema } from "@arx/core/ui";
import * as Hex from "ox/Hex";
import type browser from "webextension-polyfill";

export { UI_CHANNEL } from "@arx/core/ui";

const MIN_AUTO_LOCK_MS = 60_000;
const MAX_AUTO_LOCK_MS = 60 * 60_000;

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
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
};

const normalizeError = (error: unknown): { message: string; code?: number; data?: unknown } => {
  if (error && typeof error === "object" && "message" in error) {
    const err = error as { message?: string; code?: number; data?: unknown };
    return { message: err.message ?? "Unknown error", code: err.code, data: err.data };
  }
  return { message: String(error ?? "Unknown error") };
};

const providerErrors = getProviderErrors();
const uiLog = createLogger("bg:uiBridge");
const assertUnlocked = (session: BackgroundSessionServices) => {
  if (!session.unlock.isUnlocked()) {
    throw providerErrors.unauthorized({ message: "Wallet is locked" });
  }
};

const verifyExportPassword = async (session: BackgroundSessionServices, password: string): Promise<void> => {
  // Fresh password check prevents stale unlock sessions from exporting secrets.
  await session.vault.verifyPassword(password);
};

const withSensitiveBytes = <T>(secret: Uint8Array, transform: (bytes: Uint8Array) => T): T => {
  try {
    return transform(secret);
  } finally {
    zeroize(secret);
  }
};

const toPlainHex = (bytes: Uint8Array): string => {
  const out = Hex.from(bytes);
  return out.startsWith("0x") ? out.slice(2) : out;
};

const normalizeUiError = (error: unknown) => {
  const base = normalizeError(error);
  const code = (error as { code?: unknown })?.code;

  if (typeof base.code === "number") return base;

  switch (code) {
    case "ARX_VAULT_LOCKED":
    case "ARX_VAULT_INVALID_PASSWORD":
    case "ARX_KEYRING_SECRET_UNAVAILABLE":
      return { message: base.message, code: 4100 };
    case "ARX_KEYRING_INVALID_MNEMONIC":
    case "ARX_KEYRING_INVALID_PRIVATE_KEY":
    case "ARX_KEYRING_INVALID_ADDRESS":
    case "ARX_KEYRING_INDEX_OUT_OF_RANGE":
      return { message: base.message, code: 32602 };
    case "ARX_KEYRING_DUPLICATE_ACCOUNT":
      return { message: base.message, code: 4001, data: { reason: "resourceExists" } };
    case "ARX_KEYRING_ACCOUNT_NOT_FOUND":
      return { message: base.message, code: 32602 };
    default:
      return { message: base.message, code: 4200 };
  }
};

// Generic diagnostic converter for warnings and issues
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

// Payload type definitions for approval tasks
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

export const createUiBridge = ({ controllers, session, persistVaultMeta, keyring, attention }: BridgeDeps) => {
  const ports = new Set<browser.Runtime.Port>();
  const portCleanups = new Map<browser.Runtime.Port, () => void>();
  const listeners: Array<() => void> = [];

  const sendToPortSafely = (port: browser.Runtime.Port, envelope: UiPortEnvelope): boolean => {
    try {
      port.postMessage(envelope);
      return true;
    } catch (error) {
      console.warn("[uiBridge] drop stale UI port", error);
      ports.delete(port);
      const cleanup = portCleanups.get(port);
      cleanup?.();
      return false;
    }
  };

  // Helper to extract typed payload
  const extractPayload = <T>(payload: unknown): T => payload as T;

  const toApprovalSummary = (task: ApprovalTask<unknown>): UiSnapshot["approvals"][number] => {
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
        return {
          ...base,
          type: "requestAccounts",
          payload: {
            suggestedAccounts: Array.isArray(payload.suggestedAccounts) ? payload.suggestedAccounts : [],
          },
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

  const buildSnapshot = (): UiSnapshot => {
    const chain = controllers.network.getActiveChain();
    const networkState = controllers.network.getState();
    const activePointer = controllers.accounts.getActivePointer();
    const resolvedChain = activePointer?.chainRef ?? chain.chainRef;
    const accountList = session.unlock.isUnlocked()
      ? controllers.accounts.getAccounts({ chainRef: resolvedChain })
      : [];

    const approvalState = controllers.approvals.getState();
    const approvalSummaries = approvalState.pending
      .map((item) => {
        const task = controllers.approvals.get(item.id);
        return task ? toApprovalSummary(task) : null;
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

  const broadcast = () => {
    let snapshot: UiSnapshot;
    try {
      snapshot = buildSnapshot();
    } catch (error) {
      console.warn("[uiBridge] failed to build snapshot", error);
      return;
    }

    for (const port of Array.from(ports)) {
      const envelope: UiPortEnvelope = { type: "ui:event", event: "ui:stateChanged", payload: snapshot };
      sendToPortSafely(port, envelope);
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
        // Wait for keyring hydration to complete before broadcasting
        await keyring.waitForReady();
        await persistVaultMeta();
        broadcast();
        const unlockedAt = Date.now();
        // Notify UI that unlock completed (after hydration).
        for (const port of Array.from(ports)) {
          sendToPortSafely(port, { type: "ui:event", event: "ui:unlocked", payload: { at: Date.now() } });
        }
        uiLog("event:ui:unlocked", { at: unlockedAt });

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
      case "ui:approve": {
        const task = controllers.approvals.get(message.payload.id);
        if (!task) throw new Error("Approval not found");

        switch (task.type) {
          case ApprovalTypes.SendTransaction: {
            const result = await controllers.approvals.resolve(task.id, async () => {
              const approved = await controllers.transactions.approveTransaction(task.id);
              if (!approved) throw new Error("Transaction not found");
              await controllers.transactions.processTransaction(task.id);
              return approved;
            });
            broadcast();
            return { id: task.id, result };
          }
          case ApprovalTypes.RequestAccounts: {
            const result = await controllers.approvals.resolve(task.id, async () => {
              const accounts = await controllers.accounts.requestAccounts({
                origin: task.origin,
                chainRef: task.chainRef ?? controllers.network.getActiveChain().chainRef,
              });
              if (accounts.length > 0) {
                await controllers.permissions.grant(task.origin, PermissionScopes.Basic, {
                  namespace: task.namespace ?? "eip155",
                  chainRef: task.chainRef,
                });
                await controllers.permissions.grant(task.origin, PermissionScopes.Accounts, {
                  namespace: task.namespace ?? "eip155",
                  chainRef: task.chainRef,
                });
              }
              return accounts;
            });
            broadcast();
            return { id: task.id, result };
          }
          case ApprovalTypes.SignMessage: {
            const payload = task.payload as { from: string; message: string };
            const result = await controllers.approvals.resolve(task.id, async () => {
              const signature = await controllers.signers.eip155.signPersonalMessage({
                address: payload.from,
                message: payload.message,
              });
              await controllers.permissions.grant(task.origin, PermissionScopes.Sign, {
                namespace: task.namespace ?? "eip155",
                chainRef: task.chainRef,
              });
              return signature;
            });
            broadcast();
            return { id: task.id, result };
          }
          case ApprovalTypes.SignTypedData: {
            const payload = task.payload as { from: string; typedData: unknown };
            const result = await controllers.approvals.resolve(task.id, async () => {
              const typedDataStr =
                typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData);
              const signature = await controllers.signers.eip155.signTypedData({
                address: payload.from,
                typedData: typedDataStr,
              });
              await controllers.permissions.grant(task.origin, PermissionScopes.Sign, {
                namespace: task.namespace ?? "eip155",
                chainRef: task.chainRef,
              });
              return signature;
            });
            broadcast();
            return { id: task.id, result };
          }
          case ApprovalTypes.RequestPermissions: {
            const payload = extractPayload<RequestPermissionsApprovalPayload>(task.payload);
            const result = await controllers.approvals.resolve(task.id, async () => ({
              granted: payload.requested,
            }));
            broadcast();
            return { id: task.id, result };
          }
          case ApprovalTypes.AddChain: {
            const payload = task.payload as { metadata: unknown };
            const result = await controllers.approvals.resolve(task.id, async () => {
              await controllers.chainRegistry.upsertChain(
                payload.metadata as Parameters<typeof controllers.chainRegistry.upsertChain>[0],
              );
              return null;
            });
            broadcast();
            return { id: task.id, result };
          }

          default:
            throw new Error(`Unsupported approval type: ${task.type}`);
        }
      }
      case "ui:reject": {
        const task = controllers.approvals.get(message.payload.id);
        if (!task) throw new Error("Approval not found");

        controllers.approvals.reject(task.id, new Error(message.payload.reason ?? "User rejected"));
        broadcast();
        return { id: task.id };
      }
      case "ui:setAutoLockDuration": {
        const value = message.payload.durationMs;
        if (!Number.isFinite(value)) {
          throw new Error("Auto-lock duration must be a number");
        }
        const rounded = Math.round(value);
        if (rounded < MIN_AUTO_LOCK_MS || rounded > MAX_AUTO_LOCK_MS) {
          throw new Error("Auto-lock duration must be between 1 and 60 minutes");
        }
        session.unlock.setAutoLockDuration(rounded);
        session.unlock.scheduleAutoLock(rounded);
        await persistVaultMeta();
        broadcast();
        const state = session.unlock.getState();
        return { autoLockDurationMs: state.timeoutMs, nextAutoLockAt: state.nextAutoLockAt };
      }

      case "ui:generateMnemonic": {
        assertUnlocked(session);
        const mnemonic = keyring.generateMnemonic(message.payload?.wordCount ?? 12);
        return { words: mnemonic.split(" ") };
      }
      case "ui:confirmNewMnemonic": {
        assertUnlocked(session);
        const result = await keyring.confirmNewMnemonic(message.payload.words.join(" "), {
          alias: message.payload.alias,
          skipBackup: message.payload.skipBackup,
          namespace: message.payload.namespace,
        });
        broadcast();
        return result;
      }
      case "ui:importMnemonic": {
        assertUnlocked(session);
        const result = await keyring.importMnemonic(message.payload.words.join(" "), {
          alias: message.payload.alias,
          namespace: message.payload.namespace,
        });
        broadcast();
        return result;
      }
      case "ui:importPrivateKey": {
        assertUnlocked(session);
        const result = await keyring.importPrivateKey(message.payload.privateKey, {
          alias: message.payload.alias,
          namespace: message.payload.namespace,
        });
        broadcast();
        return result;
      }
      case "ui:deriveAccount": {
        assertUnlocked(session);
        const result = await keyring.deriveAccount(message.payload.keyringId);
        broadcast();
        return result;
      }
      case "ui:getKeyrings": {
        assertUnlocked(session);
        return keyring.getKeyrings();
      }
      case "ui:getAccountsByKeyring": {
        assertUnlocked(session);
        return keyring.getAccountsByKeyring(message.payload.keyringId, message.payload.includeHidden ?? false);
      }
      case "ui:renameKeyring": {
        assertUnlocked(session);
        await keyring.renameKeyring(message.payload.keyringId, message.payload.alias);
        broadcast();
        return null;
      }
      case "ui:renameAccount": {
        assertUnlocked(session);
        await keyring.renameAccount(message.payload.address, message.payload.alias);
        broadcast();
        return null;
      }
      case "ui:markBackedUp": {
        assertUnlocked(session);
        await keyring.markBackedUp(message.payload.keyringId);
        broadcast();
        return null;
      }
      case "ui:hideHdAccount": {
        assertUnlocked(session);
        await keyring.hideHdAccount(message.payload.address);
        broadcast();
        return null;
      }
      case "ui:unhideHdAccount": {
        assertUnlocked(session);
        await keyring.unhideHdAccount(message.payload.address);
        broadcast();
        return null;
      }
      case "ui:removePrivateKeyKeyring": {
        assertUnlocked(session);
        await keyring.removePrivateKeyKeyring(message.payload.keyringId);
        broadcast();
        return null;
      }
      case "ui:exportMnemonic": {
        assertUnlocked(session);
        await verifyExportPassword(session, message.payload.password);
        let mnemonic = await keyring.exportMnemonic(message.payload.keyringId, message.payload.password);
        // Split before clearing from memory
        const words = mnemonic.split(" ");
        // Clear mnemonic from memory
        mnemonic = "";
        return { words };
      }
      case "ui:exportPrivateKey": {
        assertUnlocked(session);
        await verifyExportPassword(session, message.payload.password);
        const secret = await keyring.exportPrivateKeyByAddress(message.payload.address, message.payload.password);
        const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
        return { privateKey };
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
        sendToPortSafely(port, { type: "ui:response", requestId: envelope.requestId, result });
      } catch (error) {
        sendToPortSafely(port, {
          type: "ui:error",
          requestId: envelope.requestId,
          error: normalizeUiError(error),
        });
      }
    };

    const cleanup = () => {
      ports.delete(port);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      portCleanups.delete(port);
    };

    const onDisconnect = () => {
      cleanup();
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    portCleanups.set(port, cleanup);
    sendToPortSafely(port, { type: "ui:event", event: "ui:stateChanged", payload: buildSnapshot() });
  };

  const attachListeners = () => {
    listeners.push(
      controllers.accounts.onStateChanged(() => broadcast()),
      controllers.network.onStateChanged(() => broadcast()),
      controllers.approvals.onStateChanged(() => {
        try {
          const approvalState = controllers.approvals.getState();
          const approvalSummaries = approvalState.pending
            .map((item) => {
              const task = controllers.approvals.get(item.id);
              return task ? toApprovalSummary(task) : null;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          for (const port of Array.from(ports)) {
            sendToPortSafely(port, { type: "ui:event", event: "ui:approvalsChanged", payload: approvalSummaries });
          }
          uiLog("event:ui:approvalsChanged", { count: approvalSummaries.length });
        } catch (error) {
          console.warn("[uiBridge] failed to emit ui:approvalsChanged", error);
        }

        broadcast();
      }),
      session.unlock.onLocked(() => broadcast()),
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
    for (const cleanup of portCleanups.values()) {
      cleanup();
    }
    ports.clear();
    portCleanups.clear();
  };

  return {
    attachPort,
    handleMessage,
    attachListeners,
    broadcast,
    teardown,
  };
};
