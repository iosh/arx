import { ArxReasons, arxError } from "@arx/errors";
import * as Hex from "ox/Hex";
import { ApprovalTypes } from "../../controllers/approval/types.js";
import { PermissionScopes } from "../../controllers/permission/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import { zeroize } from "../../vault/utils.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiRuntimeDeps } from "./types.js";

const MIN_AUTO_LOCK_MS = 60_000;
const MAX_AUTO_LOCK_MS = 60 * 60_000;

const assertUnlocked = (session: BackgroundSessionServices) => {
  if (!session.unlock.isUnlocked()) {
    throw arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked" });
  }
};

const verifyExportPassword = async (session: BackgroundSessionServices, password: string): Promise<void> => {
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

export const createUiHandlers = (deps: UiRuntimeDeps) => {
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

    "ui.vault.init": async ({ password }: { password: string }) => {
      const ciphertext = await session.vault.initialize({ password });
      return { ciphertext };
    },

    "ui.vault.initAndUnlock": async ({ password }: { password: string }) => {
      const status = session.vault.getStatus();
      if (!status.hasCiphertext) {
        await session.vault.initialize({ password });
      }
      await session.unlock.unlock({ password });
      await keyring.waitForReady();
      return session.unlock.getState();
    },

    "ui.session.unlock": async ({ password }: { password: string }) => {
      await session.unlock.unlock({ password });
      await keyring.waitForReady();
      return session.unlock.getState();
    },

    "ui.session.lock": async (payload?: { reason?: "manual" | "timeout" | "blur" | "suspend" | "reload" }) => {
      session.unlock.lock(payload?.reason ?? "manual");
      return session.unlock.getState();
    },

    "ui.session.resetAutoLockTimer": async () => {
      session.unlock.scheduleAutoLock();
      return session.unlock.getState();
    },

    "ui.session.setAutoLockDuration": async ({ durationMs }: { durationMs: number }) => {
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

    "ui.onboarding.openTab": async ({ reason }: { reason: string }) => {
      return await platform.openOnboardingTab(reason);
    },

    "ui.accounts.switchActive": async ({ chainRef, address }: { chainRef: string; address?: string | null }) => {
      await controllers.accounts.switchActive({
        chainRef,
        address: address ?? null,
      });
      return buildSnapshot().accounts.active;
    },

    "ui.networks.switchActive": async ({ chainRef }: { chainRef: string }) => {
      await controllers.network.switchChain(chainRef);
      return toChainSnapshot();
    },

    "ui.approvals.approve": async ({ id }: { id: string }) => {
      const task = controllers.approvals.get(id);
      if (!task) throw new Error("Approval not found");

      switch (task.type) {
        case ApprovalTypes.SendTransaction: {
          const result = await controllers.approvals.resolve(task.id, async () => {
            const approved = await controllers.transactions.approveTransaction(task.id);
            if (!approved) throw new Error("Transaction not found");
            await controllers.transactions.processTransaction(task.id);
            return approved;
          });
          return { id: task.id, result };
        }
        case ApprovalTypes.RequestAccounts: {
          const result = await controllers.approvals.resolve(task.id, async () => {
            const resolvedChainRef = task.chainRef ?? controllers.network.getActiveChain().chainRef;

            const accounts = await controllers.accounts.requestAccounts({
              origin: task.origin,
              chainRef: resolvedChainRef,
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
              namespace: task.namespace ?? "eip155",
              chainRef: resolvedChainRef,
            });
            await controllers.permissions.grant(task.origin, PermissionScopes.Accounts, {
              namespace: task.namespace ?? "eip155",
              chainRef: resolvedChainRef,
            });

            await controllers.permissions.setPermittedAccounts(task.origin, {
              namespace: task.namespace ?? "eip155",
              chainRef: resolvedChainRef,
              accounts: uniqueAccounts,
            });

            return uniqueAccounts;
          });
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
          return { id: task.id, result };
        }
        case ApprovalTypes.RequestPermissions: {
          const payload = task.payload as { requested: any[] };
          const result = await controllers.approvals.resolve(task.id, async () => ({
            granted: payload.requested,
          }));
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
          return { id: task.id, result };
        }
        default:
          throw new Error(`Unsupported approval type: ${task.type}`);
      }
    },

    "ui.approvals.reject": async ({ id, reason }: { id: string; reason?: string }) => {
      const task = controllers.approvals.get(id);
      if (!task) throw new Error("Approval not found");
      controllers.approvals.reject(task.id, new Error(reason ?? "User rejected"));
      return { id: task.id };
    },

    "ui.keyrings.generateMnemonic": async (payload?: { wordCount?: 12 | 24 }) => {
      assertUnlocked(session);
      const mnemonic = keyring.generateMnemonic(payload?.wordCount ?? 12);
      return { words: mnemonic.split(" ") };
    },

    "ui.keyrings.confirmNewMnemonic": async (params: {
      words: string[];
      alias?: string;
      skipBackup?: boolean;
      namespace?: string;
    }) => {
      assertUnlocked(session);
      return await keyring.confirmNewMnemonic(params.words.join(" "), {
        alias: params.alias,
        skipBackup: params.skipBackup,
        namespace: params.namespace,
      });
    },

    "ui.keyrings.importMnemonic": async (params: { words: string[]; alias?: string; namespace?: string }) => {
      assertUnlocked(session);
      return await keyring.importMnemonic(params.words.join(" "), { alias: params.alias, namespace: params.namespace });
    },

    "ui.keyrings.importPrivateKey": async (params: { privateKey: string; alias?: string; namespace?: string }) => {
      assertUnlocked(session);
      return await keyring.importPrivateKey(params.privateKey, { alias: params.alias, namespace: params.namespace });
    },

    "ui.keyrings.deriveAccount": async (params: { keyringId: string }) => {
      assertUnlocked(session);
      return await keyring.deriveAccount(params.keyringId);
    },

    "ui.keyrings.list": async () => {
      assertUnlocked(session);
      return keyring.getKeyrings();
    },

    "ui.keyrings.getAccountsByKeyring": async (params: { keyringId: string; includeHidden?: boolean }) => {
      assertUnlocked(session);
      return keyring.getAccountsByKeyring(params.keyringId, params.includeHidden ?? false);
    },

    "ui.keyrings.renameKeyring": async (params: { keyringId: string; alias: string }) => {
      assertUnlocked(session);
      await keyring.renameKeyring(params.keyringId, params.alias);
      return null;
    },

    "ui.keyrings.renameAccount": async (params: { address: string; alias: string }) => {
      assertUnlocked(session);
      await keyring.renameAccount(params.address, params.alias);
      return null;
    },

    "ui.keyrings.markBackedUp": async (params: { keyringId: string }) => {
      assertUnlocked(session);
      await keyring.markBackedUp(params.keyringId);
      return null;
    },

    "ui.keyrings.hideHdAccount": async (params: { address: string }) => {
      assertUnlocked(session);
      await keyring.hideHdAccount(params.address);
      return null;
    },

    "ui.keyrings.unhideHdAccount": async (params: { address: string }) => {
      assertUnlocked(session);
      await keyring.unhideHdAccount(params.address);
      return null;
    },

    "ui.keyrings.removePrivateKeyKeyring": async (params: { keyringId: string }) => {
      assertUnlocked(session);
      await keyring.removePrivateKeyKeyring(params.keyringId);
      return null;
    },

    "ui.keyrings.exportMnemonic": async (params: { keyringId: string; password: string }) => {
      assertUnlocked(session);
      await verifyExportPassword(session, params.password);
      return { words: (await keyring.exportMnemonic(params.keyringId, params.password)).split(" ") };
    },

    "ui.keyrings.exportPrivateKey": async (params: { address: string; password: string }) => {
      assertUnlocked(session);
      await verifyExportPassword(session, params.password);
      const secret = await keyring.exportPrivateKeyByAddress(params.address, params.password);
      const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
      return { privateKey };
    },
  } as const;
};
