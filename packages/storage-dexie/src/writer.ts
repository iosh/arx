import type { PersistenceChange, PersistenceWriter } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "./database.js";
import { accountToRow } from "./mappers/accounts.js";
import { permissionToRow } from "./mappers/permissions.js";
import { encryptedVaultToRow, walletChainSelectionToRow } from "./mappers/singletons.js";
import { ENCRYPTED_VAULT_ROW_KEY, WALLET_CHAIN_SELECTION_ROW_KEY } from "./rows.js";

const applyChange = async (context: DexiePersistenceContext, change: PersistenceChange): Promise<void> => {
  switch (change.persistenceType) {
    case "encryptedVault":
      if (change.operation === "put") {
        await context.db.encryptedVault.put(encryptedVaultToRow(change.value));
      } else {
        await context.db.encryptedVault.delete(ENCRYPTED_VAULT_ROW_KEY);
      }
      return;

    case "setting":
      if (change.operation === "put") {
        await context.db.settings.put(change.value);
      } else {
        await context.db.settings.delete(change.key);
      }
      return;

    case "keySource":
      if (change.operation === "put") {
        await context.db.keySources.put(change.value);
      } else {
        await context.db.keySources.delete(change.key);
      }
      return;

    case "hdKeyring":
      if (change.operation === "put") {
        await context.db.hdKeyrings.put(change.value);
      } else {
        await context.db.hdKeyrings.delete(change.key);
      }
      return;

    case "account":
      if (change.operation === "put") {
        await context.db.accounts.put(accountToRow(change.value));
      } else {
        await context.db.accounts.delete(change.key);
      }
      return;

    case "accountSelection":
      if (change.operation === "put") {
        await context.db.accountSelections.put(change.value);
      } else {
        await context.db.accountSelections.delete(change.key);
      }
      return;

    case "permission":
      if (change.operation === "put") {
        await context.db.permissions.put(permissionToRow(change.value));
      } else {
        await context.db.permissions.delete([change.key.origin, change.key.namespace]);
      }
      return;

    case "customChain":
      if (change.operation === "put") {
        await context.db.customChains.put(change.value);
      } else {
        await context.db.customChains.delete(change.key);
      }
      return;

    case "chainRpcOverride":
      if (change.operation === "put") {
        await context.db.chainRpcOverrides.put(change.value);
      } else {
        await context.db.chainRpcOverrides.delete(change.key);
      }
      return;

    case "walletChainSelection":
      if (change.operation === "put") {
        await context.db.walletChainSelection.put(walletChainSelectionToRow(change.value));
      } else {
        await context.db.walletChainSelection.delete(WALLET_CHAIN_SELECTION_ROW_KEY);
      }
      return;

    case "providerChainSelection":
      if (change.operation === "put") {
        await context.db.providerChainSelections.put(change.value);
      } else {
        await context.db.providerChainSelections.delete([change.key.origin, change.key.namespace]);
      }
      return;

    case "transaction":
      if (change.operation === "put") {
        await context.db.transactions.put(change.value);
      } else {
        await context.db.transactions.delete(change.key);
      }
      return;
  }

  change satisfies never;
};

export const createPersistenceWriter = (context: DexiePersistenceContext): PersistenceWriter => ({
  async commit(changes) {
    await context.ready;
    await context.db.transaction(
      "rw",
      [
        context.db.encryptedVault,
        context.db.settings,
        context.db.keySources,
        context.db.hdKeyrings,
        context.db.accounts,
        context.db.accountSelections,
        context.db.permissions,
        context.db.customChains,
        context.db.chainRpcOverrides,
        context.db.walletChainSelection,
        context.db.providerChainSelections,
        context.db.transactions,
      ],
      async () => {
        for (const change of changes) {
          await applyChange(context, change);
        }
      },
    );
  },
});
