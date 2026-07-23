import { describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../../chainJsonRpc/ChainJsonRpc.js";
import { Eip155PriorityFeeExceedsMaxFeeError } from "./errors.js";
import { createEip155TransactionPreparer } from "./prepareTransaction.js";

const CHAIN_REF = "eip155:1";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const createRpc = (handler: (input: ChainJsonRpcRequest) => unknown | Promise<unknown>) => {
  const request = vi.fn(async (input: ChainJsonRpcRequest) => handler(input));
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input) => (await request(input)) as TResult,
  };

  return { chainJsonRpc, request };
};

describe("EIP-155 transaction preparation", () => {
  it("fills an EIP-1559 request from the latest block", async () => {
    const { chainJsonRpc, request } = createRpc(({ method }) => {
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x10" };
      if (method === "eth_maxPriorityFeePerGas") return "0x2";
      if (method === "eth_estimateGas") return "0x5208";
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const prepare = createEip155TransactionPreparer({ chainJsonRpc });

    await expect(
      prepare({
        chainRef: CHAIN_REF,
        from: FROM,
        transaction: {
          to: TO,
          value: "0x00",
          data: "0xabcd",
          nonce: "0x01",
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: TO,
      value: "0x00",
      data: "0xabcd",
      gas: "0x5208",
      nonce: "0x01",
      fee: {
        type: "eip1559",
        maxFeePerGas: "0x22",
        maxPriorityFeePerGas: "0x2",
      },
    });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_getBlockByNumber",
      "eth_maxPriorityFeePerGas",
      "eth_estimateGas",
    ]);
    expect(request).toHaveBeenLastCalledWith({
      chainRef: CHAIN_REF,
      method: "eth_estimateGas",
      params: [
        {
          from: FROM,
          to: TO,
          value: "0x00",
          data: "0xabcd",
          maxFeePerGas: "0x22",
          maxPriorityFeePerGas: "0x2",
        },
      ],
      replay: "allowed",
    });
  });

  it("does not query RPC for a complete legacy request", async () => {
    const { chainJsonRpc, request } = createRpc(({ method }) => {
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const prepare = createEip155TransactionPreparer({ chainJsonRpc });

    await expect(
      prepare({
        chainRef: CHAIN_REF,
        from: FROM,
        transaction: {
          to: TO,
          value: "0x01",
          data: "0x",
          gas: "0x5208",
          nonce: "0x01",
          fee: { type: "legacy", gasPrice: "0x03" },
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: TO,
      value: "0x01",
      data: "0x",
      gas: "0x5208",
      nonce: "0x01",
      fee: { type: "legacy", gasPrice: "0x03" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fills only the missing EIP-1559 fee field", async () => {
    const { chainJsonRpc, request } = createRpc(({ method }) => {
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x10" };
      if (method === "eth_maxPriorityFeePerGas") return "0x2";
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const prepare = createEip155TransactionPreparer({ chainJsonRpc });

    await expect(
      prepare({
        chainRef: CHAIN_REF,
        from: FROM,
        transaction: {
          gas: "0x5208",
          nonce: "0x05",
          fee: { type: "eip1559", maxFeePerGas: "0x40" },
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: null,
      value: "0x0",
      data: "0x",
      gas: "0x5208",
      nonce: "0x05",
      fee: {
        type: "eip1559",
        maxFeePerGas: "0x40",
        maxPriorityFeePerGas: "0x2",
      },
    });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_getBlockByNumber",
      "eth_maxPriorityFeePerGas",
    ]);
  });

  it("rejects EIP-1559 fees whose priority exceeds their maximum", async () => {
    const { chainJsonRpc } = createRpc(({ method }) => {
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x10" };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const prepare = createEip155TransactionPreparer({ chainJsonRpc });

    await expect(
      prepare({
        chainRef: CHAIN_REF,
        from: FROM,
        transaction: {
          gas: "0x5208",
          fee: {
            type: "eip1559",
            maxFeePerGas: "0x1",
            maxPriorityFeePerGas: "0x2",
          },
        },
      }),
    ).rejects.toBeInstanceOf(Eip155PriorityFeeExceedsMaxFeeError);
  });
});
