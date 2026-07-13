import { describe, expect, it, vi } from "vitest";
import { buildChainAddressingByNamespace } from "../../../chains/addressing.js";
import { eip155ChainAddressing } from "../../../namespaces/eip155/chainAddressing.js";
import { TEST_ADDRESSES, TEST_CHAINS, TEST_TX_HASH, TEST_VALUES } from "./__fixtures__/constants.js";
import { createChainJsonRpcMock } from "./__mocks__/rpc.js";
import { createEip155Transaction } from "./transaction.js";

const createAdapter = (rpcHandler: Parameters<typeof createChainJsonRpcMock>[0] = () => null) => {
  const rpc = createChainJsonRpcMock(rpcHandler);
  const signer = {
    signTransaction: vi.fn(async () => ({ raw: "0xdeadbeef" })),
  };
  const broadcaster = {
    broadcast: vi.fn(async () => ({ hash: TEST_TX_HASH })),
  };

  return {
    adapter: createEip155Transaction({
      chains: buildChainAddressingByNamespace([eip155ChainAddressing]),
      chainJsonRpc: rpc.client,
      signer,
      broadcaster,
    }),
    signer,
    broadcaster,
  };
};

const createApprovedPayload = () => ({
  type: "legacy" as const,
  chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
  from: TEST_ADDRESSES.ACCOUNT_AA,
  to: TEST_ADDRESSES.TO_B,
  value: "0x0",
  data: TEST_VALUES.EMPTY_DATA,
  gas: "0x5208",
  nonce: "0x3",
  gasPrice: "0x3b9aca00",
});

describe("createEip155Transaction", () => {
  it("creates a broadcast artifact from the approved payload", async () => {
    const { adapter, signer } = createAdapter();
    if (!adapter.submission) throw new Error("Expected submission contract");

    const broadcastArtifact = await adapter.submission.createBroadcastArtifact({
      transactionId: "tx-1",
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      origin: "https://dapp.example",
      accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: TEST_ADDRESSES.ACCOUNT_AA,
      request: {
        namespace: "eip155",
        chainRef: TEST_CHAINS.MAINNET,
        payload: {
          from: TEST_ADDRESSES.ACCOUNT_AA,
          to: TEST_ADDRESSES.TO_B,
          value: "0x0",
          data: TEST_VALUES.EMPTY_DATA,
        },
      },
      approvedPayload: createApprovedPayload(),
    });

    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(broadcastArtifact).toEqual({
      kind: "eip155.raw_transaction",
      payload: { raw: "0xdeadbeef" },
    });
  });

  it("broadcasts a raw transaction and returns submitted facts", async () => {
    const { adapter, broadcaster } = createAdapter();
    if (!adapter.submission) throw new Error("Expected submission contract");

    const result = await adapter.submission.broadcast({
      transactionId: "tx-1",
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      origin: "https://dapp.example",
      accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: TEST_ADDRESSES.ACCOUNT_AA,
      request: {
        namespace: "eip155",
        chainRef: TEST_CHAINS.MAINNET,
        payload: {
          from: TEST_ADDRESSES.ACCOUNT_AA,
          to: TEST_ADDRESSES.TO_B,
          value: "0x0",
          data: TEST_VALUES.EMPTY_DATA,
        },
      },
      approvedPayload: createApprovedPayload(),
      broadcastArtifact: {
        kind: "eip155.raw_transaction",
        payload: { raw: "0xdeadbeef" },
      },
    });

    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(result.broadcastIdentity).toEqual({ hash: TEST_TX_HASH });
    expect(result.submitted).toMatchObject({
      hash: TEST_TX_HASH,
      chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
      from: TEST_ADDRESSES.ACCOUNT_AA,
      nonce: "0x3",
    });
  });

  it("inspects submitted transactions through the new tracking contract", async () => {
    const { adapter } = createAdapter(({ method }) =>
      method === "eth_getTransactionReceipt"
        ? { transactionHash: TEST_TX_HASH, status: "0x1", blockNumber: "0x123" }
        : null,
    );
    if (!adapter.tracking?.inspectSubmittedTransaction) {
      throw new Error("Expected tracking inspection contract");
    }

    const inspection = await adapter.tracking.inspectSubmittedTransaction({
      recordId: "tx-1",
      namespace: "eip155",
      chainRef: TEST_CHAINS.MAINNET,
      origin: "https://dapp.example",
      from: TEST_ADDRESSES.ACCOUNT_AA,
      submitted: {
        hash: TEST_TX_HASH,
        chainId: TEST_CHAINS.MAINNET_CHAIN_ID,
        from: TEST_ADDRESSES.ACCOUNT_AA,
        to: TEST_ADDRESSES.TO_B,
        value: "0x0",
        data: TEST_VALUES.EMPTY_DATA,
        gas: "0x5208",
        nonce: "0x3",
      },
    });

    expect(inspection).toEqual({
      trackingStatus: "confirmed",
      receipt: {
        transactionHash: TEST_TX_HASH,
        status: "0x1",
        blockNumber: "0x123",
      },
    });
  });
});
