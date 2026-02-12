import type { JsonRpcParams } from "@metamask/utils";
import type { Hex as OxHex } from "ox/Hex";
import type { RpcBlock, RpcFeeHistory, RpcTransactionReceipt } from "viem";
import type { RpcClient, RpcClientFactory, RpcTransportRequest } from "../RpcClientRegistry.js";

export type Eip155BlockRef = "latest" | "earliest" | "pending" | "safe" | "finalized" | OxHex;

// Use viem's RPC response types to avoid maintaining a parallel "RPC schema" type set.
// `import type` keeps this as compile-time only (no runtime dependency).
export type Eip155RpcBlock = RpcBlock;
export type Eip155RpcFeeHistory = RpcFeeHistory;
export type Eip155RpcTransactionReceipt = RpcTransactionReceipt;

export type Eip155TxCallParams = {
  from?: OxHex;
  to?: OxHex | null;
  value?: OxHex;
  data?: OxHex;
  gas?: OxHex;
  gasPrice?: OxHex;
  maxFeePerGas?: OxHex;
  maxPriorityFeePerGas?: OxHex;
  nonce?: OxHex;
};

export type Eip155RpcCallOverrides = {
  timeoutMs?: number;
};

export type Eip155RpcCapabilities = {
  estimateGas(
    tx: Eip155TxCallParams,
    overrides?: Eip155RpcCallOverrides & { blockTag?: Eip155BlockRef },
  ): Promise<OxHex>;
  getBalance(address: string, overrides?: Eip155RpcCallOverrides & { blockTag?: Eip155BlockRef }): Promise<OxHex>;
  getTransactionCount(
    address: string,
    overrides?: Eip155RpcCallOverrides & { blockTag?: Eip155BlockRef },
  ): Promise<OxHex>;
  getGasPrice(overrides?: Eip155RpcCallOverrides): Promise<OxHex>;
  getMaxPriorityFeePerGas(overrides?: Eip155RpcCallOverrides): Promise<OxHex>;
  getFeeHistory(
    blockCount: OxHex,
    newestBlock: Eip155BlockRef,
    rewardPercentiles: number[],
    overrides?: Eip155RpcCallOverrides,
  ): Promise<Eip155RpcFeeHistory>;
  getBlockByNumber(
    block: Eip155BlockRef,
    overrides?: Eip155RpcCallOverrides & { includeTransactions?: boolean },
  ): Promise<Eip155RpcBlock>;
  getTransactionReceipt(hash: string, overrides?: Eip155RpcCallOverrides): Promise<Eip155RpcTransactionReceipt | null>;
  sendRawTransaction(raw: string, overrides?: Eip155RpcCallOverrides): Promise<OxHex>;
};

export type Eip155RpcClient = RpcClient<Eip155RpcCapabilities>;

export const createEip155RpcClientFactory = (): RpcClientFactory<Eip155RpcCapabilities> => {
  return ({ transport }) => {
    const request = <T>(payload: RpcTransportRequest<T>) => transport(payload);

    const call = async <T>(method: string, params?: JsonRpcParams, overrides?: Eip155RpcCallOverrides): Promise<T> => {
      return await request<T>({
        method,
        ...(params !== undefined ? { params } : {}),
        ...(overrides?.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
      });
    };

    return {
      request,

      async estimateGas(tx, overrides) {
        const params = overrides?.blockTag ? [tx, overrides.blockTag] : [tx];
        return await call<OxHex>("eth_estimateGas", params, overrides);
      },

      async getTransactionCount(address, overrides) {
        const blockTag = overrides?.blockTag ?? "pending";
        const params = [address, blockTag];
        return await call<OxHex>("eth_getTransactionCount", params, overrides);
      },

      async getBalance(address, overrides) {
        const blockTag = overrides?.blockTag ?? "latest";
        const params = [address, blockTag];
        return await call<OxHex>("eth_getBalance", params, overrides);
      },

      async getGasPrice(overrides) {
        return await call<OxHex>("eth_gasPrice", undefined, overrides);
      },

      async getMaxPriorityFeePerGas(overrides) {
        return await call<OxHex>("eth_maxPriorityFeePerGas", undefined, overrides);
      },

      async getFeeHistory(blockCount, newestBlock, rewardPercentiles, overrides) {
        return await call<Eip155RpcFeeHistory>(
          "eth_feeHistory",
          [blockCount, newestBlock, rewardPercentiles],
          overrides,
        );
      },

      async getBlockByNumber(block, overrides) {
        const includeTransactions = overrides?.includeTransactions ?? false;
        return await call<Eip155RpcBlock>("eth_getBlockByNumber", [block, includeTransactions], overrides);
      },
      async getTransactionReceipt(hash, overrides) {
        return await call<Eip155RpcTransactionReceipt | null>("eth_getTransactionReceipt", [hash], overrides);
      },
      async sendRawTransaction(raw, overrides) {
        return await call<OxHex>("eth_sendRawTransaction", [raw], overrides);
      },
    };
  };
};
