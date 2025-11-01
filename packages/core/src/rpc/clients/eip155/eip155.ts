import type { JsonRpcParams } from "@metamask/utils";
import type { RpcClient, RpcClientFactory, RpcTransportRequest } from "../../RpcClientRegistry.js";

export type Eip155FeeData = {
  gasPrice?: string;
  maxPriorityFeePerGas?: string;
  maxFeePerGas?: string;
  baseFee?: string;
};

export type Eip155RpcCapabilities = {
  estimateGas(params: JsonRpcParams, overrides?: { timeoutMs?: number }): Promise<string>;
  getTransactionCount(address: string, blockTag?: string, overrides?: { timeoutMs?: number }): Promise<string>;
  getFeeData(overrides?: { timeoutMs?: number }): Promise<Eip155FeeData>;
  getTransactionReceipt(hash: string, overrides?: { timeoutMs?: number }): Promise<Record<string, unknown> | null>;
  sendRawTransaction(raw: string, overrides?: { timeoutMs?: number }): Promise<string>;
};

export type Eip155RpcClient = RpcClient<Eip155RpcCapabilities>;

const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;

const addHex = (lhs: string, rhs: string): string => {
  if (!HEX_PATTERN.test(lhs) || !HEX_PATTERN.test(rhs)) {
    throw new Error("Invalid hex input for fee calculation");
  }
  const result = BigInt(lhs) + BigInt(rhs);
  return `0x${result.toString(16)}`;
};

const buildRequest = <T>(method: string, params?: JsonRpcParams, timeoutMs?: number): RpcTransportRequest<T> => {
  const payload: RpcTransportRequest<T> = { method };
  if (params !== undefined) {
    payload.params = params;
  }
  if (timeoutMs !== undefined) {
    payload.timeoutMs = timeoutMs;
  }
  return payload;
};

export const createEip155RpcClientFactory = (): RpcClientFactory<Eip155RpcCapabilities> => {
  return ({ transport }) => {
    const call = <T>(payload: RpcTransportRequest<T>) => transport(payload);

    return {
      request: call,
      estimateGas(params, overrides) {
        return call(buildRequest("eth_estimateGas", params, overrides?.timeoutMs));
      },
      getTransactionCount(address, blockTag = "pending", overrides) {
        return call(
          buildRequest("eth_getTransactionCount", [address, blockTag] as JsonRpcParams, overrides?.timeoutMs),
        );
      },
      async getFeeData(overrides) {
        const timeout = overrides?.timeoutMs;

        const gasPricePromise = call<string>(buildRequest("eth_gasPrice", undefined, timeout));
        const priorityPromise = call<string>(buildRequest("eth_maxPriorityFeePerGas", undefined, timeout)).catch(
          () => undefined,
        );
        const latestBlockPromise = call<Record<string, unknown>>(
          buildRequest("eth_getBlockByNumber", ["latest", false], timeout),
        ).catch(() => undefined);

        const [gasPriceResult, priorityResult, latestBlock] = await Promise.all([
          gasPricePromise.catch(() => undefined),
          priorityPromise,
          latestBlockPromise,
        ]);

        const baseFee =
          latestBlock && typeof latestBlock.baseFeePerGas === "string"
            ? (latestBlock.baseFeePerGas as string)
            : undefined;

        if (!gasPriceResult && !priorityResult && !baseFee) {
          throw new Error("Failed to retrieve fee data from RPC");
        }

        let maxFeePerGas: string | undefined;
        if (baseFee && priorityResult) {
          try {
            maxFeePerGas = addHex(baseFee, priorityResult);
          } catch {
            maxFeePerGas = undefined;
          }
        }

        const feeData: Eip155FeeData = {};
        if (gasPriceResult) feeData.gasPrice = gasPriceResult;
        if (priorityResult) feeData.maxPriorityFeePerGas = priorityResult;
        if (maxFeePerGas) feeData.maxFeePerGas = maxFeePerGas;
        if (baseFee) feeData.baseFee = baseFee;

        return feeData;
      },
      getTransactionReceipt(hash, overrides) {
        return call(buildRequest("eth_getTransactionReceipt", [hash] as JsonRpcParams, overrides?.timeoutMs));
      },
      sendRawTransaction(raw, overrides) {
        return call(buildRequest("eth_sendRawTransaction", [raw] as JsonRpcParams, overrides?.timeoutMs));
      },
    };
  };
};
