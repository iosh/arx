import * as Hex from "ox/Hex";
import { RpcInternalError } from "../../../rpc/errors.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { SubmittedTransactionInspection } from "../types.js";
import type { Eip155TransactionReceipt } from "./transactionTypes.js";
import type { Eip155TrackingContext } from "./types.js";

type ReceiptDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
};

type RawReceipt = {
  status?: unknown;
  transactionHash?: string;
  blockNumber?: unknown;
  [key: string]: unknown;
};

type ReceiptLookupResult = {
  status: "success" | "failed";
  receipt: Eip155TransactionReceipt;
};

type ReplacementLookupResult = {
  status: "replaced";
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

const cloneReceipt = (receipt: RawReceipt): Eip155TransactionReceipt => {
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
  inspectSubmittedTransaction(context: Eip155TrackingContext): Promise<SubmittedTransactionInspection<"eip155">>;
};

export const createEip155ReceiptService = (deps: ReceiptDeps): Eip155ReceiptService => {
  const getClient = (chainRef: string) => {
    try {
      return deps.rpcClientFactory(chainRef);
    } catch (error) {
      throw new RpcInternalError({
        message: "Failed to create RPC client for receipt tracking.",
        cause: error,
      });
    }
  };

  const querySubmittedReceipt = async (context: Eip155TrackingContext): Promise<ReceiptLookupResult | null> => {
    const submitted = context.submitted;
    const hash = submitted.hash;
    if (!hash) {
      return null;
    }
    const client = getClient(context.chainRef);
    const rawReceipt = (await client.getTransactionReceipt(hash)) as RawReceipt | null;
    if (!rawReceipt) {
      return null;
    }

    if (rawReceipt.transactionHash && rawReceipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
      throw new RpcInternalError({
        message: "RPC node returned a receipt with mismatched transaction hash.",
      });
    }

    const receipt = cloneReceipt(rawReceipt);
    const status = deriveReceiptStatus(rawReceipt);
    return { status, receipt };
  };

  const inspectNonceConsumption = async (context: Eip155TrackingContext): Promise<ReplacementLookupResult | null> => {
    const from = context.from;
    if (!from) return null;

    const originalNonceHex = context.submitted.nonce;

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

    return { status: "replaced" };
  };

  return {
    async inspectSubmittedTransaction(context) {
      const receipt = await querySubmittedReceipt(context);
      if (receipt) {
        if (receipt.status === "success") {
          return {
            trackingStatus: "confirmed",
            receipt: receipt.receipt,
          };
        }

        return {
          trackingStatus: "failed",
          receipt: receipt.receipt,
          error: {
            code: "on_chain_failed",
            message: "EIP-155 transaction failed on chain.",
            details: {
              hash: context.submitted.hash,
              chainRef: context.chainRef,
            },
          },
        };
      }

      const replacement = await inspectNonceConsumption(context);
      if (replacement) {
        return {
          trackingStatus: "dropped",
          evidence: {
            reason: replacement.status,
          },
        };
      }

      return {
        trackingStatus: "pending",
        evidence: null,
      };
    },
  };
};
