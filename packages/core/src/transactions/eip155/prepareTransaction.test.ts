import { describe, expect, it, vi } from "vitest";
import { createChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { JsonRpcHttpRequest, JsonRpcHttpTransport } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import { Eip155PriorityFeeExceedsMaxFeeError, Eip155TransactionInvalidError } from "./errors.js";
import { createEip155TransactionPreparer } from "./prepareTransaction.js";

const CHAIN_REF = "eip155:1";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const createRpc = (handler: (input: JsonRpcHttpRequest) => unknown | Promise<unknown>) => {
  const request = vi.fn(async (input: JsonRpcHttpRequest) => handler(input));
  const chainJsonRpc = createChainJsonRpc({
    endpoints: { getRpcEndpoints: () => ["https://rpc.example"] },
    transport: { request: request as JsonRpcHttpTransport["request"] },
  });

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
          type: "auto",
          to: TO,
          value: "0x00",
          data: "0xabcd",
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: TO,
      value: "0x00",
      data: "0xabcd",
      gas: "0x5208",
      type: "eip1559",
      maxFeePerGas: "0x22",
      maxPriorityFeePerGas: "0x2",
      accessList: [],
    });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_getBlockByNumber",
      "eth_maxPriorityFeePerGas",
      "eth_estimateGas",
    ]);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "eth_estimateGas",
        params: [
          {
            from: FROM,
            to: TO,
            value: "0x00",
            data: "0xabcd",
            type: "0x2",
            maxFeePerGas: "0x22",
            maxPriorityFeePerGas: "0x2",
            accessList: [],
          },
        ],
      }),
    );
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
          type: "legacy",
          to: TO,
          value: "0x01",
          data: "0x",
          gas: "0x5208",
          gasPrice: "0x03",
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: TO,
      value: "0x01",
      data: "0x",
      gas: "0x5208",
      type: "legacy",
      gasPrice: "0x03",
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
          type: "eip1559",
          gas: "0x5208",
          maxFeePerGas: "0x40",
        },
      }),
    ).resolves.toEqual({
      from: FROM,
      to: null,
      value: "0x0",
      data: "0x",
      gas: "0x5208",
      type: "eip1559",
      maxFeePerGas: "0x40",
      maxPriorityFeePerGas: "0x2",
      accessList: [],
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
          type: "eip1559",
          gas: "0x5208",
          maxFeePerGas: "0x1",
          maxPriorityFeePerGas: "0x2",
        },
      }),
    ).rejects.toBeInstanceOf(Eip155PriorityFeeExceedsMaxFeeError);

    await expect(
      prepare({
        chainRef: CHAIN_REF,
        from: FROM,
        transaction: {
          type: "eip1559",
          gas: "0x5208",
          maxFeePerGas: `0x1${"0".repeat(64)}`,
          maxPriorityFeePerGas: "0x1",
        },
      }),
    ).rejects.toBeInstanceOf(Eip155TransactionInvalidError);
  });
});
