import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import type { DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import { builtinNamespaces } from "../namespaces/builtin.js";
import { PermissionNetworkSelectionMissingError } from "../permissions/errors.js";
import type { PermissionRecord } from "../permissions/persistence.js";
import type { CorePersistence } from "../persistence/corePersistence.js";
import { createCoreRuntime } from "./createCoreRuntime.js";

const createPersistence = (
  input: Readonly<{
    permissions?: readonly PermissionRecord[];
    networkSelections?: readonly DappNetworkSelectionRecord[];
  }> = {},
): CorePersistence => ({
  readers: {
    encryptedVault: { get: async () => null },
    settings: { get: async () => null },
    keySources: { listAll: async () => [] },
    hdKeyrings: { listAll: async () => [] },
    accounts: {
      listRecords: async () => [],
      listSelections: async () => [],
    },
    permissions: { listAll: async () => input.permissions ?? [] },
    customNetworks: { listAll: async () => [] },
    networkRpcOverrides: { listAll: async () => [] },
    networkSelection: { get: async () => null },
    dappNetworkSelections: { listAll: async () => input.networkSelections ?? [] },
    transactions: {
      get: async () => null,
      listHistory: async () => ({ transactions: [] }),
      listByConflictKey: async () => [],
      listByStatuses: async () => [],
      existsByChainRefAndStatuses: async () => false,
      listIds: async () => [],
    },
  },
  writer: { commit: async () => {} },
});

describe("createCoreRuntime", () => {
  it("rejects a persisted permission without a matching Dapp network selection", async () => {
    const permission: PermissionRecord = {
      origin: "https://dapp.example",
      namespace: "eip155",
      accountIds: ["eip155:0000000000000000000000000000000000000001" as AccountId],
    };

    await expect(
      createCoreRuntime({
        namespaces: { definitions: builtinNamespaces },
        persistence: createPersistence({ permissions: [permission] }),
      }),
    ).rejects.toThrow(PermissionNetworkSelectionMissingError);
  });
});
