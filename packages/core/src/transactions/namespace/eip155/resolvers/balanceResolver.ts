import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/namespaceClients/eip155.js";
import type { Eip155PreparedTransaction, Eip155PrepareStepResult } from "../types.js";
import {
  Eip155FieldParseError,
  parseHexQuantityToBigInt,
  parseOptionalHexQuantity,
  readErrorMessage,
} from "../utils/validation.js";

const toBigIntOrNull = (value: string | undefined): bigint | null => {
  if (!value) return null;
  try {
    return parseHexQuantityToBigInt(value, "value");
  } catch {
    return null;
  }
};

type BalanceResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  prepared: Pick<Eip155PreparedTransaction, "from" | "gas" | "value" | "gasPrice" | "maxFeePerGas">;
  additionalFeeWei?: bigint;
};

export const checkBalanceForMaxCost = async ({
  rpc,
  prepared,
  additionalFeeWei = 0n,
}: BalanceResolverParams): Promise<Eip155PrepareStepResult<Partial<Eip155PreparedTransaction>>> => {
  if (!rpc) return { status: "ok", patch: {} };
  if (!prepared.from) return { status: "ok", patch: {} };

  let gasLimit: bigint | null = null;
  let gasHex = prepared.gas ?? null;
  if (prepared.gas) {
    try {
      gasHex = parseOptionalHexQuantity(prepared.gas, "gas");
      gasLimit = gasHex ? Hex.toBigInt(gasHex) : null;
    } catch (error) {
      if (error instanceof Eip155FieldParseError) {
        return { status: "failed", error: error.toProposalError(), patch: {} };
      }
      throw error;
    }
  }
  if (gasLimit === null || !gasHex) return { status: "ok", patch: {} };

  const valueWei = toBigIntOrNull(prepared.value) ?? 0n;

  const feePerGasHex = prepared.maxFeePerGas ?? prepared.gasPrice ?? null;
  const feePerGas = feePerGasHex ? toBigIntOrNull(feePerGasHex) : null;
  if (feePerGas === null) return { status: "ok", patch: {} };

  const requiredWei = valueWei + gasLimit * feePerGas + additionalFeeWei;

  let balanceHex: string | null = null;
  try {
    balanceHex = await rpc.getBalance(prepared.from as string, { blockTag: "latest" });
  } catch (error) {
    return {
      status: "failed",
      error: {
        reason: "transaction.prepare.balance_unavailable",
        message: "Failed to fetch account balance.",
        data: { method: "eth_getBalance", blockTag: "latest", error: readErrorMessage(error) },
      },
      patch: {},
    };
  }

  if (!balanceHex) {
    return {
      status: "failed",
      error: {
        reason: "transaction.prepare.balance_unavailable",
        message: "Failed to fetch account balance.",
        data: { method: "eth_getBalance", blockTag: "latest" },
      },
      patch: {},
    };
  }

  const balanceWei = toBigIntOrNull(balanceHex);
  if (balanceWei === null) {
    return {
      status: "failed",
      error: {
        reason: "transaction.prepare.balance_unavailable",
        message: "Failed to parse account balance from RPC.",
        data: { method: "eth_getBalance", blockTag: "latest", balance: balanceHex },
      },
      patch: {},
    };
  }

  if (balanceWei < requiredWei) {
    const deficitWei = requiredWei - balanceWei;
    return {
      status: "blocked",
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds for transaction.",
        data: {
          balance: balanceHex,
          required: Hex.fromNumber(requiredWei),
          deficit: Hex.fromNumber(deficitWei),
          value: prepared.value ?? "0x0",
          gasLimit: gasHex,
          feePerGas: feePerGasHex,
          additionalFee: additionalFeeWei > 0n ? Hex.fromNumber(additionalFeeWei) : "0x0",
          balanceBlockTag: "latest",
        },
      },
      patch: {},
    };
  }

  return { status: "ok", patch: {} };
};
