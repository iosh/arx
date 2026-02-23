import { ArxReasons, arxError } from "@arx/errors";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as Hex from "ox/Hex";
import * as Value from "ox/Value";
import { toAccountIdFromAddress } from "../../accounts/accountId.js";
import { parseChainRef } from "../../chains/caip.js";
import type { ChainNamespace } from "../../controllers/account/types.js";
import { ApprovalTypes } from "../../controllers/approval/types.js";
import { PermissionCapabilities } from "../../controllers/permission/types.js";
import type { TransactionRequest } from "../../controllers/transaction/types.js";
import { keyringErrors } from "../../keyring/errors.js";
import type { Eip155RpcCapabilities } from "../../rpc/namespaceClients/eip155.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import { zeroize } from "../../vault/utils.js";
import type { UiMethodResult } from "../protocol.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiHandlers, UiRuntimeDeps } from "./types.js";

const assertUnlocked = (session: BackgroundSessionServices) => {
  if (!session.unlock.isUnlocked()) {
    throw arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked" });
  }
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

const sanitizeMnemonicPhraseFromWords = (words: string[]): string =>
  words
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

const hasAnyAccounts = (controllers: UiRuntimeDeps["controllers"]): boolean => {
  const accountsState = controllers.accounts.getState();
  return Object.values(accountsState.namespaces).some((ns) => ns.accountIds.length > 0);
};

const requireOnboardingPassword = (password: string | undefined): string => {
  if (!password || password.trim().length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Password cannot be empty",
    });
  }
  return password;
};

const validateBip39Mnemonic = (mnemonic: string): void => {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw keyringErrors.invalidMnemonic();
  }
};

const parsePrivateKeyHex = (value: string): string => {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw keyringErrors.invalidPrivateKey();
  }
  return normalized;
};

const resolveChainRefForNamespace = (controllers: UiRuntimeDeps["controllers"], namespace: string): string => {
  const active = controllers.network.getActiveChain();
  if (active.namespace === namespace) return active.chainRef;

  const known = controllers.network.getState().knownChains.find((chain) => chain.namespace === namespace);
  return known?.chainRef ?? active.chainRef;
};

const extendConnectedOriginsToChain = async (
  controllers: UiRuntimeDeps["controllers"],
  params: { namespace: ChainNamespace; chainRef: string },
): Promise<void> => {
  const { namespace, chainRef } = params;
  const origins = controllers.permissions.listConnectedOrigins({ namespace });

  for (const origin of origins) {
    // Keep connection stable across chain changes: connection is origin-level, not chain-level.
    try {
      await controllers.permissions.grant(origin, PermissionCapabilities.Basic, { namespace, chainRef });
      await controllers.permissions.grant(origin, PermissionCapabilities.Accounts, { namespace, chainRef });
    } catch (error) {
      // Best-effort: never block a user-approved chain switch on persistence quirks.
      console.debug("[ui] failed to extend connected origin permissions to chain", {
        origin,
        namespace,
        chainRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

const selectControllerAccount = async (deps: UiRuntimeDeps, params: { namespace: string; address: string }) => {
  const chainRef = resolveChainRefForNamespace(deps.controllers, params.namespace);
  await deps.controllers.accounts.switchActive({ chainRef, address: params.address });
};

const toUiAccountMeta = (record: AccountRecord) => ({
  accountId: record.accountId,
  address: `0x${record.payloadHex}`,
  keyringId: record.keyringId,
  derivationIndex: record.derivationIndex,
  alias: record.alias,
  createdAt: record.createdAt,
  hidden: record.hidden,
});

const toUiKeyringMeta = (meta: KeyringMetaRecord) => ({
  id: meta.id,
  type: meta.type,
  createdAt: meta.createdAt,
  alias: meta.name,
  ...(meta.type === "hd" ? { backedUp: meta.needsBackup !== true, derivedCount: meta.nextDerivationIndex ?? 0 } : {}),
});

// Helper to derive chain context from a task (with fallback to active chain).
const deriveChainContext = (
  task: { chainRef?: string; namespace?: string },
  controllers: { network: Pick<UiRuntimeDeps["controllers"]["network"], "getActiveChain" | "getState"> },
) => {
  const active = controllers.network.getActiveChain();

  if (task.chainRef) {
    const parsed = parseChainRef(task.chainRef);
    if (task.namespace && task.namespace !== parsed.namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Approval task has mismatched namespace and chainRef.",
        data: { namespace: task.namespace, chainRef: task.chainRef },
      });
    }
    return { chainRef: `${parsed.namespace}:${parsed.reference}`, namespace: parsed.namespace };
  }

  if (task.namespace) {
    if (active.namespace === task.namespace) {
      return { chainRef: active.chainRef, namespace: task.namespace };
    }

    const known = controllers.network.getState().knownChains.find((c) => c.namespace === task.namespace);
    if (!known) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Approval task is missing chainRef and cannot be resolved from namespace.",
        data: { namespace: task.namespace },
      });
    }

    return { chainRef: known.chainRef, namespace: task.namespace };
  }

  return { chainRef: active.chainRef, namespace: active.namespace };
};

// Approval task type
type ApprovalTask = {
  id: string;
  type: string;
  origin: string;
  chainRef?: string;
  namespace?: string;
  payload?: unknown;
};

// Approval result can be transaction meta, accounts array, signature string, permission result, or null.
// Validated by zod schema at the UI protocol boundary.
type ApprovalResult = unknown;

type ApprovalHandlerFn = (task: ApprovalTask, controllers: UiRuntimeDeps["controllers"]) => Promise<ApprovalResult>;

// Individual approval handlers organized by type
const approvalHandlers: Record<string, ApprovalHandlerFn> = {
  [ApprovalTypes.SendTransaction]: async (task, controllers) => {
    const approved = await controllers.transactions.approveTransaction(task.id);
    if (!approved) throw new Error("Transaction not found");
    return approved;
  },

  [ApprovalTypes.RequestAccounts]: async (task, controllers) => {
    const { chainRef, namespace } = deriveChainContext(task, controllers);

    const accounts = await controllers.accounts.requestAccounts({
      chainRef,
    });

    const uniqueAccounts = [...new Set(accounts)];
    if (uniqueAccounts.length === 0) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts available for connection request",
        data: { origin: task.origin, reason: "no_accounts" },
      });
    }
    const preferredAddress = controllers.accounts.getSelectedAddress({ chainRef });
    const preferred = preferredAddress && uniqueAccounts.includes(preferredAddress) ? preferredAddress : null;
    const selectedAccount = preferred ?? uniqueAccounts[0] ?? null;
    if (!selectedAccount) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No selectable account available for connection request",
        data: { origin: task.origin, reason: "no_selection" },
      });
    }

    await controllers.permissions.grant(task.origin, PermissionCapabilities.Basic, {
      namespace,
      chainRef,
    });

    await controllers.permissions.setPermittedAccounts(task.origin, {
      namespace,
      chainRef,
      accounts: [selectedAccount],
    });

    return [selectedAccount];
  },

  [ApprovalTypes.SignMessage]: async (task, controllers) => {
    const payload = task.payload as { from: string; message: string };
    const { chainRef, namespace } = deriveChainContext(task, controllers);
    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignMessage is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const signature = await controllers.signers.eip155.signPersonalMessage({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      message: payload.message,
    });

    await controllers.permissions.grant(task.origin, PermissionCapabilities.Sign, {
      namespace,
      chainRef,
    });

    return signature;
  },

  [ApprovalTypes.SignTypedData]: async (task, controllers) => {
    const payload = task.payload as { from: string; typedData: unknown };
    const { chainRef, namespace } = deriveChainContext(task, controllers);
    if (namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `SignTypedData is not supported for namespace "${namespace}".`,
        data: { namespace, chainRef },
      });
    }

    const typedDataStr = typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData);

    const signature = await controllers.signers.eip155.signTypedData({
      accountId: toAccountIdFromAddress({ chainRef, address: payload.from }),
      typedData: typedDataStr,
    });

    await controllers.permissions.grant(task.origin, PermissionCapabilities.Sign, {
      namespace,
      chainRef,
    });

    return signature;
  },

  [ApprovalTypes.RequestPermissions]: async (task) => {
    const payload = task.payload as { requested: unknown[] };
    return { granted: payload.requested };
  },

  [ApprovalTypes.SwitchChain]: async (task, controllers) => {
    const payload = task.payload as { chainRef?: string };
    const requested = payload.chainRef ?? task.chainRef;
    if (!requested) {
      throw new Error("Switch chain approval is missing chainRef");
    }

    const selected = await controllers.network.switchChain(
      requested as Parameters<typeof controllers.network.switchChain>[0],
    );
    await extendConnectedOriginsToChain(controllers, {
      namespace: selected.namespace,
      chainRef: selected.chainRef,
    });
    return null;
  },

  [ApprovalTypes.AddChain]: async (task, controllers) => {
    const payload = task.payload as { metadata: unknown };
    await controllers.chainRegistry.upsertChain(
      payload.metadata as Parameters<typeof controllers.chainRegistry.upsertChain>[0],
    );
    return null;
  },
};

export const createUiHandlers = (deps: UiRuntimeDeps): UiHandlers => {
  const { controllers, session, keyring, attention, platform, uiOrigin, rpcClients } = deps;
  // Stable session id for UI-initiated approval request contexts within this background lifetime.
  const uiSessionId = crypto.randomUUID();

  const buildSnapshot = () =>
    buildUiSnapshot({
      controllers,
      session,
      keyring,
      attention,
    });

  const toChainSnapshot = () => {
    const chain = controllers.network.getActiveChain();
    return {
      chainRef: chain.chainRef,
      chainId: chain.chainId,
      namespace: chain.namespace,
      displayName: chain.displayName,
      shortName: chain.shortName ?? null,
      icon: chain.icon?.url ?? null,
      nativeCurrency: {
        name: chain.nativeCurrency.name,
        symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals,
      },
    };
  };

  return {
    "ui.snapshot.get": async () => buildSnapshot(),

    "ui.balances.getNative": async ({ chainRef, address }) => {
      assertUnlocked(session);
      const chain = controllers.network.getChain(chainRef);
      if (!chain) {
        throw arxError({ reason: ArxReasons.ChainNotFound, message: `Unknown chain: ${chainRef}` });
      }

      if (chain.namespace !== "eip155") {
        throw arxError({
          reason: ArxReasons.ChainNotSupported,
          message: `Native balance is not supported for namespace "${chain.namespace}" yet.`,
          data: { chainRef, namespace: chain.namespace },
        });
      }

      const rpc = rpcClients.getClient<Eip155RpcCapabilities>("eip155", chainRef);
      const balanceHex = await rpc.getBalance(address, { blockTag: "latest", timeoutMs: 15_000 });
      Hex.assert(balanceHex as Hex.Hex, { strict: false });
      const amountWei = Hex.toBigInt(balanceHex as Hex.Hex);

      return { chainRef, address, amountWei: amountWei.toString(10), fetchedAt: Date.now() };
    },

    "ui.attention.openNotification": async () => {
      return await platform.openNotificationPopup();
    },
    "ui.session.unlock": async ({ password }) => {
      await session.unlock.unlock({ password });
      await keyring.waitForReady();
      return session.unlock.getState();
    },

    "ui.session.lock": async (payload) => {
      session.unlock.lock(payload?.reason ?? "manual");
      return session.unlock.getState();
    },

    "ui.session.resetAutoLockTimer": async () => {
      session.unlock.scheduleAutoLock();
      return session.unlock.getState();
    },

    "ui.session.setAutoLockDuration": async ({ durationMs }) => {
      // Params are validated by zod in the UI dispatcher.
      session.unlock.setAutoLockDuration(durationMs);
      const state = session.unlock.getState();
      return { autoLockDurationMs: state.timeoutMs, nextAutoLockAt: state.nextAutoLockAt };
    },

    "ui.onboarding.openTab": async ({ reason }) => {
      return await platform.openOnboardingTab(reason);
    },

    "ui.onboarding.generateMnemonic": async (payload) => {
      const mnemonic = keyring.generateMnemonic(payload?.wordCount ?? 12);
      return { words: mnemonic.split(" ") };
    },

    "ui.onboarding.createWalletFromMnemonic": async (params) => {
      const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
      validateBip39Mnemonic(mnemonic);

      const opts: { alias?: string; skipBackup?: boolean; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.skipBackup !== undefined) opts.skipBackup = params.skipBackup;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await session.withVaultMetaPersistHold(async () => {
        const status = session.vault.getStatus();
        if (status.hasCiphertext && hasAnyAccounts(controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        // Allow resuming "setupIncomplete" (ciphertext exists but no accounts) without re-initializing the vault.
        if (!status.hasCiphertext) {
          const password = requireOnboardingPassword(params.password);
          await session.vault.initialize({ password });
          await session.unlock.unlock({ password });
        } else if (!session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await session.unlock.unlock({ password });
        }

        await keyring.waitForReady();

        const { keyringId, address } = await keyring.confirmNewMnemonic(mnemonic, opts);
        await selectControllerAccount(deps, {
          namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
          address,
        });
        return { keyringId, address };
      });
    },

    "ui.onboarding.importWalletFromMnemonic": async (params) => {
      const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
      validateBip39Mnemonic(mnemonic);

      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await session.withVaultMetaPersistHold(async () => {
        const status = session.vault.getStatus();
        if (status.hasCiphertext && hasAnyAccounts(controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        if (!status.hasCiphertext) {
          const password = requireOnboardingPassword(params.password);
          await session.vault.initialize({ password });
          await session.unlock.unlock({ password });
        } else if (!session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await session.unlock.unlock({ password });
        }

        await keyring.waitForReady();

        const { keyringId, address } = await keyring.importMnemonic(mnemonic, opts);
        await selectControllerAccount(deps, {
          namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
          address,
        });
        return { keyringId, address };
      });
    },

    "ui.onboarding.importWalletFromPrivateKey": async (params) => {
      const privateKey = parsePrivateKeyHex(params.privateKey);

      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await session.withVaultMetaPersistHold(async () => {
        const status = session.vault.getStatus();
        if (status.hasCiphertext && hasAnyAccounts(controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        if (!status.hasCiphertext) {
          const password = requireOnboardingPassword(params.password);
          await session.vault.initialize({ password });
          await session.unlock.unlock({ password });
        } else if (!session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await session.unlock.unlock({ password });
        }

        await keyring.waitForReady();

        const { keyringId, account } = await keyring.importPrivateKey(privateKey, opts);
        await selectControllerAccount(deps, {
          namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
          address: account.address,
        });
        return { keyringId, account };
      });
    },

    "ui.accounts.switchActive": async ({ chainRef, address }) => {
      await controllers.accounts.switchActive({
        chainRef,
        address: address ?? null,
      });
      return buildSnapshot().accounts.active;
    },

    "ui.networks.switchActive": async ({ chainRef }) => {
      const selected = await controllers.network.switchChain(chainRef);
      await extendConnectedOriginsToChain(controllers, { namespace: selected.namespace, chainRef: selected.chainRef });
      return toChainSnapshot();
    },

    "ui.transactions.requestSendTransactionApproval": async ({ to, valueEther, chainRef }) => {
      assertUnlocked(session);

      const resolvedChainRef = chainRef ?? controllers.network.getActiveChain().chainRef;

      const trimmedValue = valueEther.trim();
      let wei: bigint;
      try {
        wei = Value.fromEther(trimmedValue);
      } catch (error) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Invalid amount",
          data: { valueEther: trimmedValue, error: error instanceof Error ? error.message : String(error) },
        });
      }

      const approvalId = crypto.randomUUID();
      const requestContext = {
        transport: "ui" as const,
        portId: "ui",
        sessionId: uiSessionId,
        requestId: approvalId,
        origin: uiOrigin,
      };

      const request: TransactionRequest = {
        namespace: "eip155",
        chainRef: resolvedChainRef,
        payload: {
          to,
          value: Hex.fromNumber(wei),
        },
      };
      void controllers.transactions
        .requestTransactionApproval(uiOrigin, request, requestContext, { id: approvalId })
        .catch(() => {});

      return { approvalId };
    },

    "ui.approvals.approve": async ({ id }) => {
      const task = controllers.approvals.get(id);
      if (!task) throw new Error("Approval not found");

      const handler = approvalHandlers[task.type];
      if (!handler) {
        throw new Error(`Unsupported approval type: ${task.type}`);
      }

      const result = await controllers.approvals.resolve(task.id, () => handler(task as ApprovalTask, controllers));
      return {
        id: task.id,
        result: result as UiMethodResult<"ui.approvals.approve">["result"],
      };
    },

    "ui.approvals.reject": async ({ id, reason }) => {
      const task = controllers.approvals.get(id);
      if (!task) throw new Error("Approval not found");

      const err = arxError({
        reason: ArxReasons.ApprovalRejected,
        message: reason ?? "User rejected the request.",
        data: { id: task.id, origin: task.origin, type: task.type },
      });

      if (task.type === ApprovalTypes.SendTransaction) {
        try {
          await controllers.transactions.rejectTransaction(task.id, err);
        } catch {
          // Best-effort; we still want to unblock the pending approval.
        }
      }

      controllers.approvals.reject(task.id, err);
      return { id: task.id };
    },

    "ui.keyrings.confirmNewMnemonic": async (params) => {
      assertUnlocked(session);
      const opts: { alias?: string; skipBackup?: boolean; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.skipBackup !== undefined) opts.skipBackup = params.skipBackup;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await keyring.confirmNewMnemonic(params.words.join(" "), opts);
      await selectControllerAccount(deps, {
        namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
        address: result.address,
      });
      return result;
    },

    "ui.keyrings.importMnemonic": async (params) => {
      assertUnlocked(session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await keyring.importMnemonic(params.words.join(" "), opts);
      await selectControllerAccount(deps, {
        namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
        address: result.address,
      });
      return result;
    },

    "ui.keyrings.importPrivateKey": async (params) => {
      assertUnlocked(session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await keyring.importPrivateKey(params.privateKey, opts);
      await selectControllerAccount(deps, {
        namespace: opts.namespace ?? controllers.network.getActiveChain().namespace,
        address: result.account.address,
      });
      return result;
    },

    "ui.keyrings.deriveAccount": async (params) => {
      assertUnlocked(session);
      const account = await keyring.deriveAccount(params.keyringId);
      return account;
    },

    "ui.keyrings.list": async () => {
      assertUnlocked(session);
      const metas = keyring.getKeyrings();
      return metas.map(toUiKeyringMeta);
    },

    "ui.keyrings.getAccountsByKeyring": async (params) => {
      assertUnlocked(session);
      const records = keyring.getAccountsByKeyring(params.keyringId, params.includeHidden ?? false);
      return records.map(toUiAccountMeta);
    },

    "ui.keyrings.renameKeyring": async (params) => {
      assertUnlocked(session);
      await keyring.renameKeyring(params.keyringId, params.alias);
      return null;
    },

    "ui.keyrings.renameAccount": async (params) => {
      assertUnlocked(session);
      await keyring.renameAccount(params.accountId, params.alias);
      return null;
    },

    "ui.keyrings.markBackedUp": async (params) => {
      assertUnlocked(session);
      await keyring.markBackedUp(params.keyringId);
      return null;
    },

    "ui.keyrings.hideHdAccount": async (params) => {
      assertUnlocked(session);
      await keyring.hideHdAccount(params.accountId);
      return null;
    },

    "ui.keyrings.unhideHdAccount": async (params) => {
      assertUnlocked(session);
      await keyring.unhideHdAccount(params.accountId);
      return null;
    },

    "ui.keyrings.removePrivateKeyKeyring": async (params) => {
      assertUnlocked(session);
      await keyring.removePrivateKeyKeyring(params.keyringId);
      return null;
    },

    "ui.keyrings.exportMnemonic": async (params) => {
      assertUnlocked(session);
      return { words: (await keyring.exportMnemonic(params.keyringId, params.password)).split(" ") };
    },

    "ui.keyrings.exportPrivateKey": async (params) => {
      assertUnlocked(session);
      const secret = await keyring.exportPrivateKeyByAccountId(params.accountId, params.password);
      const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
      return { privateKey };
    },
  } as const satisfies UiHandlers;
};
