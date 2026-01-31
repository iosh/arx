import { ArxReasons, arxError } from "@arx/errors";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as Hex from "ox/Hex";
import { ApprovalTypes } from "../../controllers/approval/types.js";
import { PermissionScopes } from "../../controllers/permission/types.js";
import { keyringErrors } from "../../keyring/errors.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import { zeroize } from "../../vault/utils.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiHandlers, UiRuntimeDeps } from "./types.js";

const MIN_AUTO_LOCK_MS = 60_000;
const MAX_AUTO_LOCK_MS = 60 * 60_000;

const assertUnlocked = (session: BackgroundSessionServices) => {
  if (!session.unlock.isUnlocked()) {
    throw arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked" });
  }
};

const verifyExportPassword = async (session: BackgroundSessionServices, password: string): Promise<void> => {
  if (!password || password.trim().length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Password cannot be empty",
    });
  }

  try {
    await session.vault.verifyPassword(password);
  } catch (error) {
    throw arxError({
      reason: ArxReasons.VaultInvalidPassword,
      message: "Password verification failed",
      data: { context: "export_operation" },
    });
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
  return Object.values(accountsState.namespaces).some((ns) => ns.all.length > 0);
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

// Helper to derive chain context from a task (with fallback to active chain).
const deriveChainContext = (
  task: { chainRef?: string; namespace?: string },
  controllers: { network: { getActiveChain: () => { chainRef: string } } },
) => {
  const chainRef = task.chainRef ?? controllers.network.getActiveChain().chainRef;
  const namespace = task.namespace ?? "eip155";
  return { chainRef, namespace };
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

// Approval result can be transaction meta, accounts array, signature string, permission result, or null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApprovalResult = any; // Will be validated by zod schema

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
      origin: task.origin,
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

    await controllers.permissions.grant(task.origin, PermissionScopes.Basic, {
      namespace,
      chainRef,
    });
    await controllers.permissions.grant(task.origin, PermissionScopes.Accounts, {
      namespace,
      chainRef,
    });

    await controllers.permissions.setPermittedAccounts(task.origin, {
      namespace,
      chainRef,
      accounts: uniqueAccounts,
    });

    return uniqueAccounts;
  },

  [ApprovalTypes.SignMessage]: async (task, controllers) => {
    const payload = task.payload as { from: string; message: string };
    const { chainRef, namespace } = deriveChainContext(task, controllers);

    const signature = await controllers.signers.eip155.signPersonalMessage({
      address: payload.from,
      message: payload.message,
    });

    await controllers.permissions.grant(task.origin, PermissionScopes.Sign, {
      namespace,
      chainRef,
    });

    return signature;
  },

  [ApprovalTypes.SignTypedData]: async (task, controllers) => {
    const payload = task.payload as { from: string; typedData: unknown };
    const { chainRef, namespace } = deriveChainContext(task, controllers);

    const typedDataStr = typeof payload.typedData === "string" ? payload.typedData : JSON.stringify(payload.typedData);

    const signature = await controllers.signers.eip155.signTypedData({
      address: payload.from,
      typedData: typedDataStr,
    });

    await controllers.permissions.grant(task.origin, PermissionScopes.Sign, {
      namespace,
      chainRef,
    });

    return signature;
  },

  [ApprovalTypes.RequestPermissions]: async (task) => {
    const payload = task.payload as { requested: any[] };
    return { granted: payload.requested };
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
  const { controllers, session, keyring, attention, platform } = deps;

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
    };
  };

  return {
    "ui.snapshot.get": async () => buildSnapshot(),

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
      if (!Number.isFinite(durationMs)) {
        throw new Error("Auto-lock duration must be a number");
      }
      const rounded = Math.round(durationMs);
      if (rounded < MIN_AUTO_LOCK_MS || rounded > MAX_AUTO_LOCK_MS) {
        throw new Error("Auto-lock duration must be between 1 and 60 minutes");
      }
      session.unlock.setAutoLockDuration(rounded);
      session.unlock.scheduleAutoLock(rounded);
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
      await controllers.network.switchChain(chainRef);
      return toChainSnapshot();
    },

    "ui.approvals.approve": async ({ id }) => {
      const task = controllers.approvals.get(id);
      if (!task) throw new Error("Approval not found");

      const handler = approvalHandlers[task.type];
      if (!handler) {
        throw new Error(`Unsupported approval type: ${task.type}`);
      }

      const result = await controllers.approvals.resolve(task.id, () => handler(task as ApprovalTask, controllers));

      return { id: task.id, result };
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
      return await keyring.confirmNewMnemonic(params.words.join(" "), opts);
    },

    "ui.keyrings.importMnemonic": async (params) => {
      assertUnlocked(session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      return await keyring.importMnemonic(params.words.join(" "), opts);
    },

    "ui.keyrings.importPrivateKey": async (params) => {
      assertUnlocked(session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      return await keyring.importPrivateKey(params.privateKey, opts);
    },

    "ui.keyrings.deriveAccount": async (params) => {
      assertUnlocked(session);
      return await keyring.deriveAccount(params.keyringId);
    },

    "ui.keyrings.list": async () => {
      assertUnlocked(session);
      return keyring.getKeyrings();
    },

    "ui.keyrings.getAccountsByKeyring": async (params) => {
      assertUnlocked(session);
      return keyring.getAccountsByKeyring(params.keyringId, params.includeHidden ?? false);
    },

    "ui.keyrings.renameKeyring": async (params) => {
      assertUnlocked(session);
      await keyring.renameKeyring(params.keyringId, params.alias);
      return null;
    },

    "ui.keyrings.renameAccount": async (params) => {
      assertUnlocked(session);
      await keyring.renameAccount(params.address, params.alias);
      return null;
    },

    "ui.keyrings.markBackedUp": async (params) => {
      assertUnlocked(session);
      await keyring.markBackedUp(params.keyringId);
      return null;
    },

    "ui.keyrings.hideHdAccount": async (params) => {
      assertUnlocked(session);
      await keyring.hideHdAccount(params.address);
      return null;
    },

    "ui.keyrings.unhideHdAccount": async (params) => {
      assertUnlocked(session);
      await keyring.unhideHdAccount(params.address);
      return null;
    },

    "ui.keyrings.removePrivateKeyKeyring": async (params) => {
      assertUnlocked(session);
      await keyring.removePrivateKeyKeyring(params.keyringId);
      return null;
    },

    "ui.keyrings.exportMnemonic": async (params) => {
      assertUnlocked(session);
      await verifyExportPassword(session, params.password);
      return { words: (await keyring.exportMnemonic(params.keyringId, params.password)).split(" ") };
    },

    "ui.keyrings.exportPrivateKey": async (params) => {
      assertUnlocked(session);
      await verifyExportPassword(session, params.password);
      const secret = await keyring.exportPrivateKeyByAddress(params.address, params.password);
      const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
      return { privateKey };
    },
  } as const satisfies UiHandlers;
};
