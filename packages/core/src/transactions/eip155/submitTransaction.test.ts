import * as Hash from "ox/Hash";
import * as TxEnvelopeEip1559 from "ox/TxEnvelopeEip1559";
import * as TxEnvelopeEip2930 from "ox/TxEnvelopeEip2930";
import * as TxEnvelopeLegacy from "ox/TxEnvelopeLegacy";
import { describe, expect, it, vi } from "vitest";
import { ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import { ChainJsonRpcHttpTransportError } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import { createEip155RawTransactionBroadcaster } from "../../namespaces/eip155/broadcastRawTransaction.js";
import { chainRefFromChainId, MAX_EIP155_CHAIN_ID } from "../../namespaces/eip155/chainId.js";
import { Eip155InvalidChainIdError } from "../../namespaces/eip155/errors.js";
import { createEip155TransactionSubmitter } from "./submitTransaction.js";
import type * as Eip155 from "./types.js";

const CHAIN_REF = "eip155:1";
const RPC_ENDPOINT = "https://rpc.example";
const ACCOUNT_ID = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ACCESS_LIST = [
  {
    address: TO,
    storageKeys: ["0x0000000000000000000000000000000000000000000000000000000000000000"],
  },
] as const;

const signedTransaction = (rawTransaction: `0x${string}` = "0xdeadbeef"): Eip155.SignedTransaction => ({
  chainRef: CHAIN_REF,
  hash: Hash.keccak256(rawTransaction),
  transaction: {
    from: FROM,
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    type: "legacy",
    gasPrice: "0x1",
  },
  recovery: { rawTransaction },
});

const createRpc = () => {
  const request = vi.fn().mockRejectedValue(new Error("Unexpected RPC request."));
  const broadcastRawTransaction = createEip155RawTransactionBroadcaster({
    endpoints: { getRpcEndpoints: () => [RPC_ENDPOINT] },
    transport: { request },
  });
  return { broadcastRawTransaction, request };
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
    const { broadcastRawTransaction } = createRpc();
    const { signing, signDigest } = createSigning();
    signDigest.mockResolvedValue({ r: 1n, s: 2n, yParity: 1, bytes: new Uint8Array(64) });
    const submitter = createEip155TransactionSubmitter({ broadcastRawTransaction, signing });
    const chainRef = chainRefFromChainId(MAX_EIP155_CHAIN_ID);
    const transaction = {
      from: FROM,
      to: TO,
      value: "0x1",
      data: "0x",
      gas: "0x5208",
      nonce: "0x1",
      type: "legacy",
      gasPrice: "0x3b9aca00",
    } satisfies Eip155.PreparedTransaction;

    const signed = await submitter.sign({
      chainRef,
      accountId: ACCOUNT_ID,
      transaction,
    });

    expect(TxEnvelopeLegacy.deserialize(signed.recovery.rawTransaction)).toMatchObject({
      chainId: Number(MAX_EIP155_CHAIN_ID),
      yParity: 1,
      nonce: 1n,
      gasPrice: 1_000_000_000n,
      gas: 21_000n,
      to: TO,
      value: 1n,
    });
    expect(signed.chainRef).toBe(chainRef);
    expect(signDigest).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, digest: expect.any(Uint8Array) });
    expect(signed.transaction).toEqual({ ...transaction, nonce: "0x1" });

    await expect(
      submitter.sign({
        chainRef: `eip155:${MAX_EIP155_CHAIN_ID + 1n}`,
        accountId: ACCOUNT_ID,
        transaction,
      }),
    ).rejects.toBeInstanceOf(Eip155InvalidChainIdError);
  });

  it("signs an EIP-2930 transaction with its access list", async () => {
    const { broadcastRawTransaction } = createRpc();
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ broadcastRawTransaction, signing });
    const transaction = {
      from: FROM,
      to: TO,
      value: "0x1",
      data: "0x",
      gas: "0x5208",
      nonce: "0x1",
      type: "eip2930",
      gasPrice: "0x3b9aca00",
      accessList: ACCESS_LIST,
    } satisfies Eip155.PreparedTransaction;

    const signed = await submitter.sign({
      chainRef: CHAIN_REF,
      accountId: ACCOUNT_ID,
      transaction,
    });

    expect(TxEnvelopeEip2930.deserialize(signed.recovery.rawTransaction as TxEnvelopeEip2930.Serialized)).toMatchObject(
      {
        chainId: 1,
        nonce: 1n,
        gasPrice: 1_000_000_000n,
        accessList: ACCESS_LIST,
      },
    );
  });

  it("signs and broadcasts an EIP-1559 transaction", async () => {
    const { broadcastRawTransaction, request } = createRpc();
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ broadcastRawTransaction, signing });
    const signed = await submitter.sign({
      chainRef: CHAIN_REF,
      accountId: ACCOUNT_ID,
      transaction: {
        from: FROM,
        to: null,
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x9",
        type: "eip1559",
        maxFeePerGas: "0x77359400",
        maxPriorityFeePerGas: "0x59682f00",
        accessList: [],
      },
    });

    const hash = Hash.keccak256(signed.recovery.rawTransaction);
    request.mockResolvedValueOnce(hash);
    await expect(submitter.broadcast(signed)).resolves.toEqual({
      status: "accepted",
      transactionHash: hash,
    });

    expect(TxEnvelopeEip1559.deserialize(signed.recovery.rawTransaction as TxEnvelopeEip1559.Serialized)).toMatchObject(
      {
        chainId: 1,
        nonce: 9n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_500_000_000n,
        gas: 21_000n,
        value: 1n,
      },
    );
    expect(request).toHaveBeenCalledWith({
      endpoint: RPC_ENDPOINT,
      method: "eth_sendRawTransaction",
      params: [signed.recovery.rawTransaction],
    });
  });

  it("returns the signed hash when raw broadcast outcome is unknown", async () => {
    const { broadcastRawTransaction, request } = createRpc();
    request.mockRejectedValueOnce(new ChainJsonRpcHttpTransportError("RPC connection lost."));
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ broadcastRawTransaction, signing });
    const rawTransaction = "0xdeadbeef" as const;

    await expect(submitter.broadcast(signedTransaction(rawTransaction))).resolves.toEqual({
      status: "unknown",
      transactionHash: Hash.keccak256(rawTransaction),
    });
  });

  it("maps an explicit raw broadcast rejection to a transaction failure", async () => {
    const { broadcastRawTransaction, request } = createRpc();
    request.mockRejectedValueOnce(
      new ChainJsonRpcResponseError({
        rpcCode: -32_000,
        message: "insufficient funds",
        data: { available: "0x0" },
      }),
    );
    const { signing } = createSigning();
    const submitter = createEip155TransactionSubmitter({ broadcastRawTransaction, signing });

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
