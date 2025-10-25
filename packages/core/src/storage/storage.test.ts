import { describe, expect, it } from "vitest";
import { PermissionScopes } from "../controllers/index.js";
import {
  ACCOUNTS_SNAPSHOT_VERSION,
  AccountsSnapshotSchema,
  NETWORK_SNAPSHOT_VERSION,
  NetworkSnapshotSchema,
  PERMISSIONS_SNAPSHOT_VERSION,
  PermissionsSnapshotSchema,
  TRANSACTIONS_SNAPSHOT_VERSION,
  TransactionsSnapshotSchema,
  VAULT_META_SNAPSHOT_VERSION,
  VaultMetaSnapshotSchema,
} from "./schemas.js";

const TIMESTAMP = 1_706_000_000_000;

const createMetadata = (params: {
  chainRef: string;
  chainId: string;
  displayName: string;
  rpcUrl: string;
  namespace?: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
}) => ({
  chainRef: params.chainRef,
  namespace: params.namespace ?? params.chainRef.split(":")[0]!,
  chainId: params.chainId,
  displayName: params.displayName,
  nativeCurrency: params.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: params.rpcUrl, type: "public" as const }],
});

describe("storage schemas", () => {
  it("accepts a valid network snapshot", () => {
    const mainnet = createMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum",
      rpcUrl: "https://rpc.mainnet.example",
    });

    const goerli = createMetadata({
      chainRef: "eip155:5",
      chainId: "0x5",
      displayName: "Goerli",
      nativeCurrency: { name: "Goerli Ether", symbol: "gETH", decimals: 18 },
      rpcUrl: "https://rpc.testnet.example",
    });

    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        activeChain: mainnet.chainRef,
        knownChains: [mainnet, goerli],
        rpc: {
          [mainnet.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: mainnet.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [{ index: 0, successCount: 5, failureCount: 0, consecutiveFailures: 0 }],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP - 500,
          },
          [goerli.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: goerli.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [
              {
                index: 0,
                successCount: 1,
                failureCount: 3,
                consecutiveFailures: 1,
                lastError: { message: "unreachable", capturedAt: TIMESTAMP - 250 },
                lastFailureAt: TIMESTAMP - 250,
                cooldownUntil: TIMESTAMP + 5_000,
              },
            ],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP,
          },
        },
      },
    };

    expect(NetworkSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);
  });

  it("rejects network snapshots when the active chain is missing", () => {
    const goerli = createMetadata({
      chainRef: "eip155:5",
      chainId: "0x5",
      displayName: "Goerli",
      nativeCurrency: { name: "Goerli Ether", symbol: "gETH", decimals: 18 },
      rpcUrl: "https://rpc.testnet.example",
    });

    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        activeChain: "eip155:1",
        knownChains: [goerli],
        rpc: {
          [goerli.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: goerli.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [{ index: 0, successCount: 0, failureCount: 0, consecutiveFailures: 0 }],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP,
          },
        },
      },
    };

    const result = NetworkSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
    expect(result?.error?.issues[0]?.path).toEqual(["payload", "knownChains"]);
  });

  it("validates accounts snapshots and enforces primary inclusion", () => {
    const snapshot = {
      version: ACCOUNTS_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        namespaces: {
          eip155: { all: ["0xabc", "0xdef"], primary: "0xabc" },
        },
        active: { namespace: "eip155", chainRef: "eip155:1", address: "0xabc" },
      },
    };

    expect(AccountsSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);

    const invalidPrimary = {
      ...snapshot,
      payload: {
        namespaces: {
          eip155: { all: ["0xabc"], primary: "0xdef" },
        },
        active: snapshot.payload.active,
      },
    };

    const primaryResult = AccountsSnapshotSchema.safeParse(invalidPrimary);

    expect(primaryResult.success).toBe(false);
    expect(primaryResult?.error?.issues[0]?.path).toEqual(["payload", "namespaces", "eip155", "primary"]);

    const invalidActive = {
      ...snapshot,
      payload: {
        namespaces: snapshot.payload.namespaces,
        active: { namespace: "eip155", chainRef: "eip155:1", address: "0x999" },
      },
    };

    const activeResult = AccountsSnapshotSchema.safeParse(invalidActive);

    expect(activeResult.success).toBe(false);
    expect(activeResult?.error?.issues[0]?.path).toEqual(["payload", "active"]);
  });

  it("reject permissions snapshots with invalid origin", () => {
    const snapshot = {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        origins: {
          "https://dapp.example": {
            eip155: {
              scopes: [PermissionScopes.Basic],
              chains: ["eip155:1"],
            },
          },
        },
      },
    };

    expect(PermissionsSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);

    const invalid = {
      ...snapshot,
      payload: {
        origins: {
          "not-a-valid-origin": {
            eip155: {
              scopes: [PermissionScopes.Basic],
              chains: [],
            },
          },
        },
      },
    };
    const result = PermissionsSnapshotSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    expect(result?.error?.issues[0]?.path).toEqual(["payload", "origins", "not-a-valid-origin"]);
  });

  it("validates transaction snapshots", () => {
    const transaction = {
      id: "tx-1",
      caip2: "eip155:1",
      origin: "https://dapp.example",
      from: "0xabc",
      request: {
        namespace: "eip155" as const,
        caip2: "eip155:1",
        payload: {
          chainId: "0x1",
          from: "0xabc",
          to: "0xdef",
          value: "0x0",
          data: "0x",
        },
      },
      status: "pending" as const,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };

    const snapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        pending: [transaction],
        history: [],
      },
    };

    expect(TransactionsSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);
  });

  it("accepts a valid vault meta snapshot", () => {
    const snapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        ciphertext: {
          version: 1,
          algorithm: "pbkdf2-sha256",
          salt: "base64salt",
          iterations: 600_000,
          iv: "base64iv",
          cipher: "base64cipher",
          createdAt: TIMESTAMP,
        },
        autoLockDuration: 900_000,
        initializedAt: TIMESTAMP,
      },
    };
    expect(VaultMetaSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);
  });

  it("rejects vault meta snapshot when ciphertext shape is invalid", () => {
    const invalid = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        ciphertext: { version: 1 },
        autoLockDuration: 900_000,
        initializedAt: TIMESTAMP,
      },
    };
    expect(VaultMetaSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a valid network snapshot", () => {
    const mainnet = createMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum",
      rpcUrl: "https://rpc.mainnet.example",
    });
    const goerli = createMetadata({
      chainRef: "eip155:5",
      chainId: "0x5",
      displayName: "Goerli",
      nativeCurrency: { name: "Goerli Ether", symbol: "gETH", decimals: 18 },
      rpcUrl: "https://rpc.testnet.example",
    });

    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        activeChain: mainnet.chainRef,
        knownChains: [mainnet, goerli],
        rpc: {
          [mainnet.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: mainnet.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [{ index: 0, successCount: 3, failureCount: 0, consecutiveFailures: 0 }],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP - 100,
          },
          [goerli.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: goerli.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [
              {
                index: 0,
                successCount: 0,
                failureCount: 2,
                consecutiveFailures: 2,
                lastError: { message: "unreachable", capturedAt: TIMESTAMP - 50 },
                lastFailureAt: TIMESTAMP - 50,
              },
            ],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP,
          },
        },
      },
    };

    expect(NetworkSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);
  });

  it("rejects network snapshots when the active chain is missing", () => {
    const goerli = createMetadata({
      chainRef: "eip155:5",
      chainId: "0x5",
      displayName: "Goerli",
      nativeCurrency: { name: "Goerli Ether", symbol: "gETH", decimals: 18 },
      rpcUrl: "https://rpc.testnet.example",
    });

    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        activeChain: "eip155:1",
        knownChains: [goerli],
        rpc: {
          [goerli.chainRef]: {
            activeIndex: 0,
            endpoints: [{ index: 0, url: goerli.rpcEndpoints[0]!.url, type: "public" as const }],
            health: [{ index: 0, successCount: 0, failureCount: 0, consecutiveFailures: 0 }],
            strategy: { id: "round-robin" },
            lastUpdatedAt: TIMESTAMP,
          },
        },
      },
    };

    const result = NetworkSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
    expect(result?.error?.issues[0]?.path).toEqual(["payload", "knownChains"]);
  });
});
