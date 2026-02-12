import { ArxReasons, arxError } from "@arx/errors";
import * as Hex from "ox/Hex";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { ReceiptResolution, ReplacementResolution, TransactionAdapterContext } from "../types.js";

type ReceiptDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
};

type RawReceipt = {
  status?: unknown;
  transactionHash?: string;
  blockNumber?: unknown;
  [key: string]: unknown;
};

const SUCCESS_STATUS = "0x1";
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;

const cloneValue = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return Hex.fromNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }
  return value;
};

const cloneReceipt = (receipt: RawReceipt): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(receipt).map(([key, entry]) => [key, cloneValue(entry)]));
};

const deriveReceiptStatus = (receipt: RawReceipt): "success" | "failed" => {
  const status = receipt.status;

  if (typeof status === "string") {
    const normalized = status.toLowerCase();

    // raw JSON-RPC: 0x1 / 0x0 / ...
    if (normalized === SUCCESS_STATUS) {
      return "success";
    }
    if (HEX_PATTERN.test(normalized)) {
      // any other hex status (e.g. 0x0) is treated as failure
      return "failed";
    }
  }

  const blockNumber = receipt.blockNumber;

  // JSON-RPC: blockNumber is hex string when included in a block
  if (typeof blockNumber === "string" && HEX_PATTERN.test(blockNumber)) {
    return "success";
  }

  return "failed";
};

const extractNonce = (context: TransactionAdapterContext): string | null => {
  const payload = context.request.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const nonce = (payload as { nonce?: unknown }).nonce;
  if (typeof nonce !== "string" || !HEX_PATTERN.test(nonce)) {
    return null;
  }
  return nonce;
};

const toBigInt = (value: string): bigint | null => {
  if (!HEX_PATTERN.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export type Eip155ReceiptService = {
  fetchReceipt(context: TransactionAdapterContext, hash: string): Promise<ReceiptResolution | null>;
  detectReplacement(context: TransactionAdapterContext): Promise<ReplacementResolution | null>;
};

export const createEip155ReceiptService = (deps: ReceiptDeps): Eip155ReceiptService => {
  const getClient = (chainRef: string) => {
    try {
      return deps.rpcClientFactory(chainRef);
    } catch (error) {
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to create RPC client for receipt tracking.",
        data: { chainRef, error: error instanceof Error ? error.message : String(error) },
        cause: error,
      });
    }
  };

  return {
    async fetchReceipt(context, hash) {
      const client = getClient(context.chainRef);
      const rawReceipt = (await client.getTransactionReceipt(hash)) as RawReceipt | null;
      if (!rawReceipt) {
        return null;
      }

      if (rawReceipt.transactionHash && rawReceipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: "RPC node returned a receipt with mismatched transaction hash.",
          data: { expected: hash, received: rawReceipt.transactionHash },
        });
      }

      const receipt = cloneReceipt(rawReceipt);
      const status = deriveReceiptStatus(rawReceipt);
      return { status, receipt };
    },

    async detectReplacement(context) {
      const from = context.from;
      if (!from) return null;

      const originalNonceHex = extractNonce(context);
      if (!originalNonceHex) return null;

      const client = getClient(context.chainRef);
      const latestNonceHex = await client.getTransactionCount(from, { blockTag: "latest" });
      if (typeof latestNonceHex !== "string") {
        return null;
      }

      const latestNonce = toBigInt(latestNonceHex);
      const originalNonce = toBigInt(originalNonceHex);
      if (latestNonce === null || originalNonce === null) {
        return null;
      }

      if (latestNonce <= originalNonce) {
        return null;
      }

      return { status: "replaced", hash: null };
    },
  };
};
