import type { Hex } from "ox/Hex";
import { describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { PendingTransactionRecord } from "../persistence.js";
import { createEip155NonceCoordinator } from "./nonceCoordinator.js";
import type * as Eip155 from "./types.js";

const CHAIN_REF: ChainRef = "eip155:1";
const OTHER_CHAIN_REF: ChainRef = "eip155:137";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_FROM = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const transaction = (from: string, nonce?: Hex): Eip155.PreparedTransaction => ({
  from,
  to: null,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  ...(nonce === undefined ? {} : { nonce }),
  type: "legacy",
  gasPrice: "0x1",
});

const pendingRecord = (input: {
  transactionId: string;
  chainRef?: ChainRef;
  from?: string;
  nonce: Hex;
  replacesTransactionId?: string;
}): PendingTransactionRecord => ({
  transactionId: input.transactionId,
  namespace: "eip155",
  chainRef: input.chainRef ?? CHAIN_REF,
  accountId: `eip155:${(input.from ?? FROM).slice(2)}`,
  initiator: { type: "wallet" },
  ...(input.replacesTransactionId === undefined ? {} : { replacesTransactionId: input.replacesTransactionId }),
  transaction: transaction(input.from ?? FROM, input.nonce) as Eip155.SignableTransaction,
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
});

const createRpc = (nonce: Hex) => {
  const request = vi.fn(async (_input: ChainJsonRpcRequest) => nonce);
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input: ChainJsonRpcRequest) => (await request(input)) as TResult,
  };
  return { chainJsonRpc, request };
};

describe("EIP-155 nonce coordination", () => {
  it("preserves an explicit nonce without reading local or network state", async () => {
    const { chainJsonRpc, request } = createRpc("0x5");
    const listPending = vi.fn(async () => []);
    const coordinator = createEip155NonceCoordinator({ chainJsonRpc, listPending });

    const nonce = await coordinator.withTransactionNonce(
      { chainRef: CHAIN_REF, transaction: transaction(FROM, "0x9") },
      async (signable) => signable.nonce,
    );

    expect(nonce).toBe("0x9");
    expect(listPending).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("serializes one sender through commit while another sender remains independent", async () => {
    let pending: readonly PendingTransactionRecord[] = [
      pendingRecord({ transactionId: "pending-5", nonce: "0x5" }),
      pendingRecord({ transactionId: "replacement-5", nonce: "0x5", replacesTransactionId: "pending-5" }),
      pendingRecord({ transactionId: "pending-8", nonce: "0x8" }),
      pendingRecord({ transactionId: "other-chain-6", chainRef: OTHER_CHAIN_REF, nonce: "0x6" }),
      pendingRecord({ transactionId: "other-sender-6", from: OTHER_FROM, nonce: "0x6" }),
    ];
    const { chainJsonRpc } = createRpc("0x5");
    const coordinator = createEip155NonceCoordinator({
      chainJsonRpc,
      listPending: async () => pending,
    });
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let notifyFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });
    let secondStarted = false;

    const first = coordinator.withTransactionNonce(
      { chainRef: CHAIN_REF, transaction: transaction(FROM) },
      async (signable) => {
        expect(signable.nonce).toBe("0x6");
        pending = [...pending, pendingRecord({ transactionId: "pending-6", nonce: signable.nonce })];
        notifyFirstStarted();
        await firstPaused;
        return signable.nonce;
      },
    );
    await firstStarted;

    const second = coordinator.withTransactionNonce(
      { chainRef: CHAIN_REF, transaction: transaction(FROM) },
      async (signable) => {
        secondStarted = true;
        return signable.nonce;
      },
    );
    const otherSender = coordinator.withTransactionNonce(
      { chainRef: CHAIN_REF, transaction: transaction(OTHER_FROM) },
      async (signable) => signable.nonce,
    );

    await expect(otherSender).resolves.toBe("0x5");
    expect(secondStarted).toBe(false);

    releaseFirst();
    await expect(first).resolves.toBe("0x6");
    await expect(second).resolves.toBe("0x7");
  });
});
