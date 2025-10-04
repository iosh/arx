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
} from "./schemas.js";

const TIMESTAMP = 1_706_000_000_000;

describe("storage schemas", () => {
  it("accepts a valid network snapshot", () => {
    const mainnet = {
      caip2: "eip155:1",
      chainId: "0x1",
      rpcUrl: "https://rpc.mainnet.example",
      name: "Ethereum",
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
    };

    const goerli = {
      caip2: "eip155:5",
      chainId: "0x5",
      rpcUrl: "https://rpc.testnet.example",
      name: "Goerli",
      nativeCurrency: {
        name: "Goerli Ether",
        symbol: "gETH",
        decimals: 18,
      },
    };

    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        active: mainnet,
        knownChains: [mainnet, goerli],
      },
    };

    expect(NetworkSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);
  });

  it("rejects network snapshots when the active chain is mission", () => {
    const snapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        active: {
          caip2: "eip155:1",
          chainId: "0x1",
          rpcUrl: "https://rpc.mainnet.example",
          name: "Ethereum",
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
        },
        knownChains: [
          {
            caip2: "eip155:5",
            chainId: "0x5",
            rpcUrl: "https://rpc.testnet.example",
            name: "Goerli",
            nativeCurrency: {
              name: "Goerli Ether",
              symbol: "gETH",
              decimals: 18,
            },
          },
        ],
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
        all: ["0xabc", "0xdef"],
        primary: "0xabc",
      },
    };

    expect(AccountsSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);

    const invalid = {
      ...snapshot,
      payload: {
        all: ["0xabc"],
        primary: "0xdef",
      },
    };

    const result = AccountsSnapshotSchema.safeParse(invalid);

    expect(result.success).toBe(false);

    expect(result?.error?.issues[0]?.path).toEqual(["payload", "primary"]);
  });

  it("reject permissions snapshots with invalid origin", () => {
    const snapshot = {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      updatedAt: TIMESTAMP,
      payload: {
        origins: {
          "https://dapp.example": [PermissionScopes.Basic],
        },
      },
    };

    expect(PermissionsSnapshotSchema.parse(snapshot)).toStrictEqual(snapshot);

    const invalid = {
      ...snapshot,
      payload: {
        origins: {
          "not-a-valid-origin": [PermissionScopes.Basic],
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
});
