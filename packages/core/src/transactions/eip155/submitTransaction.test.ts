import * as Hash from "ox/Hash";
import * as TransactionEnvelopeEip1559 from "ox/TransactionEnvelopeEip1559";
import * as TransactionEnvelopeLegacy from "ox/TransactionEnvelopeLegacy";
import { describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import { createEip155TransactionSubmitter } from "./submitTransaction.js";

const CHAIN_REF = "eip155:1";
const ACCOUNT_ID = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const signedTransaction = (rawTransaction: `0x${string}` = "0xdeadbeef") => ({
  chainRef: CHAIN_REF,
  transaction: {
    from: FROM,
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    fee: { type: "legacy" as const, gasPrice: "0x1" },
  },
  recovery: { rawTransaction },
});

const createRpc = (handler: (input: ChainJsonRpcRequest) => unknown | Promise<unknown>) => {
  const request = vi.fn(async (input: ChainJsonRpcRequest) => handler(input));
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input) => (await request(input)) as TResult,
  };

  return { chainJsonRpc, request };
};

const createSigning = () => {
  const signDigest = vi.fn(async () => ({
    r: 1n,
    s: 2n,
    yParity: 0,
    bytes: new Uint8Array(64),
  }));
  const signing = { signDigest } satisfies Eip155AccountSigning;

  return { signing, signDigest };
};

describe("EIP-155 transaction submission", () => {
  it("signs a legacy transaction with the account signature", async () => {
    const { chainJsonRpc } = createRpc(() => {
      throw new Error("Unexpected RPC request");
    });
    const { signing, signDigest } = createSigning();
    const submitter = createEip155TransactionSubmitter({ chainJsonRpc, signing });
    const transaction = {
      from: FROM,
      to: TO,
      value: "0x1",
      data: "0x",
      gas: "0x5208",
      nonce: "0x1",
      fee: { type: "legacy" as const, gasPrice: "0x3b9aca00" },
    };

    const signingInput = await submitter.createSigningInput({
      chainRef: CHAIN_REF,
      accountId: ACCOUNT_ID,
      transaction,
    });
    const signed = await submitter.sign(signingInput);

    expect(TransactionEnvelopeLegacy.deserialize(signed.recovery.rawTransaction)).toMatchObject({
      chainId: 1,
      nonce: 1n,
      gasPrice: 1_000_000_000n,
      gas: 21_000n,
      to: TO,
      value: 1n,
    });
    expect(signed.chainRef).toBe(CHAIN_REF);
    expect(signDigest).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, digest: expect.any(Uint8Array) });
    expect(signed.transaction).toEqual({ ...transaction, nonce: "0x1" });
  });

  it("uses pending nonce lookup and a forbidden-replay raw broadcast for EIP-1559", async () => {
    const { chainJsonRpc, request } = createRpc(({ method }) => {
      if (method === "eth_getTransactionCount") return "0x9";
      if (method === "eth_sendRawTransaction") return TRANSACTION_HASH;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ chainJsonRpc, signing });
    const signingInput = await submitter.createSigningInput({
      chainRef: CHAIN_REF,
      accountId: ACCOUNT_ID,
      transaction: {
        from: FROM,
        to: null,
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        fee: {
          type: "eip1559",
          maxFeePerGas: "0x77359400",
          maxPriorityFeePerGas: "0x59682f00",
        },
      },
    });
    const signed = await submitter.sign(signingInput);

    await expect(submitter.broadcast(signed)).resolves.toEqual({
      status: "accepted",
      transactionHash: TRANSACTION_HASH,
    });

    expect(TransactionEnvelopeEip1559.deserialize(signed.recovery.rawTransaction)).toMatchObject({
      chainId: 1,
      nonce: 9n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      gas: 21_000n,
      value: 1n,
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      chainRef: CHAIN_REF,
      method: "eth_getTransactionCount",
      params: [FROM, "pending"],
      replay: "allowed",
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      chainRef: CHAIN_REF,
      method: "eth_sendRawTransaction",
      params: [signed.recovery.rawTransaction],
      replay: "forbidden",
    });
  });

  it("derives the EIP-155 hash when raw broadcast outcome is unknown", async () => {
    const { chainJsonRpc } = createRpc(() => {
      throw new ChainJsonRpcOutcomeUnknownError({
        chainRef: CHAIN_REF,
        method: "eth_sendRawTransaction",
      });
    });
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ chainJsonRpc, signing });
    const rawTransaction = "0xdeadbeef" as const;

    await expect(submitter.broadcast(signedTransaction(rawTransaction))).resolves.toEqual({
      status: "unknown",
      transactionHash: Hash.keccak256(rawTransaction),
    });
  });

  it("maps an explicit raw broadcast rejection to a transaction failure", async () => {
    const { chainJsonRpc } = createRpc(() => {
      throw new ChainJsonRpcResponseError({
        chainRef: CHAIN_REF,
        method: "eth_sendRawTransaction",
        rpcCode: -32_000,
        message: "insufficient funds",
        data: { available: "0x0" },
      });
    });
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ chainJsonRpc, signing });

    await expect(submitter.broadcast(signedTransaction())).resolves.toEqual({
      status: "rejected",
      failure: {
        type: "broadcast",
        code: -32_000,
        message: "insufficient funds",
        data: { available: "0x0" },
      },
    });
  });
});
