import type { JsonRpcParams } from "@metamask/utils";
import type { Hex as OxHex } from "ox/Hex";
import * as Hex from "ox/Hex";
import type {
  Address,
  BlockTag,
  Client,
  EIP1193RequestFn,
  EstimateGasParameters,
  GetTransactionCountParameters,
  GetTransactionReceiptParameters,
  Hash,
  Transport,
} from "viem";
import { createClient, createTransport, TransactionReceiptNotFoundError } from "viem";
import {
  estimateFeesPerGas as viemEstimateFeesPerGas,
  estimateGas as viemEstimateGas,
  getGasPrice as viemGetGasPrice,
  getTransactionCount as viemGetTransactionCount,
  getTransactionReceipt as viemGetTransactionReceipt,
  sendRawTransaction as viemSendRawTransaction,
} from "viem/actions";
import type { RpcClient, RpcClientFactory, RpcTransport, RpcTransportRequest } from "../../RpcClientRegistry.js";
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

type Eip155ViemClient = Client<Transport, undefined, undefined>;

/**
 * Create a minimal viem client backed by our RpcTransport.
 * It forwards requests to the given transport and respects per-call timeout.
 */
const createViemClient = (transport: RpcTransport, timeoutMs?: number): Eip155ViemClient => {
  const request = (async ({ method, params }: { method: string; params?: unknown }, _options?: unknown) => {
    const payload: RpcTransportRequest = { method };
    if (params !== undefined) {
      payload.params = params as JsonRpcParams;
    }
    if (timeoutMs !== undefined) {
      payload.timeoutMs = timeoutMs;
    }
    return transport(payload);
  }) as EIP1193RequestFn;

  const viemTransport: Transport = () =>
    createTransport({
      key: "arx-eip155",
      name: "arx-eip155",
      type: "arx-eip155",
      request,
      // RpcTransport already implements retries, so disable viem-level retry.
      retryCount: 0,
    });

  return createClient({ transport: viemTransport });
};

const toBigIntQuantity = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    return undefined;
  }
  try {
    return Hex.toBigInt(value as OxHex);
  } catch {
    return undefined;
  }
};

const normalizeBlockSelector = (blockTag?: string): { blockTag?: BlockTag; blockNumber?: bigint } => {
  if (!blockTag) {
    return {};
  }

  // Common tags used by EVM nodes.
  if (
    blockTag === "latest" ||
    blockTag === "earliest" ||
    blockTag === "pending" ||
    blockTag === "safe" ||
    blockTag === "finalized"
  ) {
    return { blockTag: blockTag as BlockTag };
  }

  // Hex block number (e.g. "0x10")
  if (HEX_PATTERN.test(blockTag)) {
    try {
      return { blockNumber: Hex.toBigInt(blockTag as OxHex) };
    } catch {
      return {};
    }
  }

  // Unknown format -> let fallback path handle it.
  return {};
};

const toNonceNumber = (value: unknown): number | undefined => {
  const quantity = toBigIntQuantity(value);
  if (quantity === undefined) return undefined;
  const numeric = Number(quantity);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric;
};

export const createEip155RpcClientFactory = (): RpcClientFactory<Eip155RpcCapabilities> => {
  return ({ transport }) => {
    const call = <T>(payload: RpcTransportRequest<T>) => transport(payload);

    return {
      request: call,
      async estimateGas(params, overrides) {
        const timeoutMs = overrides?.timeoutMs;

        const [rawTx] = params as [Record<string, unknown>, ...unknown[]];
        const client = createViemClient(transport, timeoutMs);

        const estimateParams: EstimateGasParameters = {
          // We disable viem's internal prepareTransactionRequest pipeline
          // to avoid extra RPC calls (gas/fees/nonce are already handled upstream).
          prepare: false,
        } as EstimateGasParameters;

        if (typeof rawTx.from === "string") {
          estimateParams.account = rawTx.from as Address;
        }
        if (typeof rawTx.to === "string") {
          estimateParams.to = rawTx.to as Address;
        }
        if (typeof rawTx.data === "string") {
          estimateParams.data = rawTx.data as OxHex;
        }

        const gas = toBigIntQuantity(rawTx.gas);
        if (gas !== undefined) estimateParams.gas = gas;

        const value = toBigIntQuantity(rawTx.value);
        if (value !== undefined) estimateParams.value = value;

        const gasPrice = toBigIntQuantity(rawTx.gasPrice);
        if (gasPrice !== undefined) estimateParams.gasPrice = gasPrice;

        const maxFeePerGas = toBigIntQuantity(rawTx.maxFeePerGas);
        if (maxFeePerGas !== undefined) estimateParams.maxFeePerGas = maxFeePerGas;

        const maxPriorityFeePerGas = toBigIntQuantity(rawTx.maxPriorityFeePerGas);
        if (maxPriorityFeePerGas !== undefined) {
          estimateParams.maxPriorityFeePerGas = maxPriorityFeePerGas;
        }

        const nonce = toNonceNumber(rawTx.nonce);
        if (nonce !== undefined) estimateParams.nonce = nonce;

        const gasBigInt = await viemEstimateGas(client as Client, estimateParams as EstimateGasParameters);
        return Hex.fromNumber(gasBigInt);
      },

      async getTransactionCount(address, blockTag = "pending", overrides) {
        const timeoutMs = overrides?.timeoutMs;
        const client = createViemClient(transport, timeoutMs);

        const selector = normalizeBlockSelector(blockTag);

        const params: GetTransactionCountParameters = {
          address: address as Address,
          ...(selector.blockNumber !== undefined
            ? { blockNumber: selector.blockNumber }
            : { blockTag: selector.blockTag ?? ("latest" as BlockTag) }),
        };

        const count = await viemGetTransactionCount(client as Client, params as GetTransactionCountParameters);
        return Hex.fromNumber(count);
      },
      async getFeeData(overrides) {
        const timeoutMs = overrides?.timeoutMs;
        const client = createViemClient(transport, timeoutMs);

        try {
          // Ask viem for best-effort fee suggestion (EIP-1559 or legacy).
          const fees = await viemEstimateFeesPerGas(
            client as Client,
            {} as Parameters<typeof viemEstimateFeesPerGas>[1],
          );

          const feeData: Eip155FeeData = {};

          // EIP-1559 path: viem returns maxFeePerGas and maxPriorityFeePerGas
          if (
            "maxFeePerGas" in fees &&
            "maxPriorityFeePerGas" in fees &&
            fees.maxFeePerGas !== undefined &&
            fees.maxPriorityFeePerGas !== undefined
          ) {
            feeData.maxFeePerGas = Hex.fromNumber(fees.maxFeePerGas);
            feeData.maxPriorityFeePerGas = Hex.fromNumber(fees.maxPriorityFeePerGas);
          }

          // Legacy path: viem returns gasPrice
          if ("gasPrice" in fees && fees.gasPrice !== undefined) {
            feeData.gasPrice = Hex.fromNumber(fees.gasPrice);
          }

          // If nothing was set, fall back to getGasPrice
          if (Object.keys(feeData).length === 0) {
            const gasPrice = await viemGetGasPrice(client as Client);
            feeData.gasPrice = Hex.fromNumber(gasPrice);
          }

          return feeData;
        } catch {
          // Fallback: only gasPrice when fee estimation is not available.
          const gasPrice = await viemGetGasPrice(client as Client);
          return { gasPrice: Hex.fromNumber(gasPrice) };
        }
      },
      async getTransactionReceipt(hash, overrides) {
        const timeoutMs = overrides?.timeoutMs;
        const client = createViemClient(transport, timeoutMs);

        try {
          const receipt = await viemGetTransactionReceipt(
            client as Client,
            { hash: hash as Hash } as GetTransactionReceiptParameters,
          );
          // viem formats the receipt into a typed object; we expose it as a generic record.
          return receipt as unknown as Record<string, unknown>;
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError) {
            // Align with JSON-RPC: "no receipt yet" -> null.
            return null;
          }
          throw error;
        }
      },
      async sendRawTransaction(raw, overrides) {
        const timeoutMs = overrides?.timeoutMs;
        const client = createViemClient(transport, timeoutMs);

        const hash = await viemSendRawTransaction(client as Client, { serializedTransaction: raw as OxHex });

        return hash;
      },
    };
  };
};
