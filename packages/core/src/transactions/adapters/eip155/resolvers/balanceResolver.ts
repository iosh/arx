import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/clients/eip155/eip155.js";
import type { Eip155PreparedTransaction, Eip155PreparedTransactionResult } from "../types.js";
import { parseHexQuantity, pushIssue, pushWarning, readErrorMessage } from "../utils/validation.js";

const toBigIntOrNull = (value: string | undefined): bigint | null => {
  if (!value) return null;
  try {
    const trimmed = value.trim().toLowerCase();
    Hex.assert(trimmed as Hex.Hex, { strict: false });
    return Hex.toBigInt(trimmed as Hex.Hex);
  } catch {
    return null;
  }
};

type BalanceResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  prepared: Pick<Eip155PreparedTransaction, "from" | "gas" | "value" | "gasPrice" | "maxFeePerGas">;
  issues: Eip155PreparedTransactionResult["issues"];
  warnings: Eip155PreparedTransactionResult["warnings"];
  additionalFeeWei?: bigint;
};

export const checkBalanceForMaxCost = async ({
  rpc,
  prepared,
  issues,
  warnings,
  additionalFeeWei = 0n,
}: BalanceResolverParams): Promise<void> => {
  if (!rpc) return;
  if (!prepared.from) return;

  const gasHex = prepared.gas ? parseHexQuantity(issues, prepared.gas, "gas") : null;
  if (!gasHex) return;

  const gasLimit = toBigIntOrNull(gasHex);
  if (gasLimit === null) return;

  const valueWei = toBigIntOrNull(prepared.value) ?? 0n;

  // Use the maximum possible fee-per-gas for the balance coverage check.
  const feePerGasHex = prepared.maxFeePerGas ?? prepared.gasPrice ?? null;
  const feePerGas = feePerGasHex ? toBigIntOrNull(feePerGasHex) : null;
  if (feePerGas === null) return;

  const requiredWei = valueWei + gasLimit * feePerGas + additionalFeeWei;

  let balanceHex: string | null = null;
  try {
    balanceHex = await rpc.getBalance(prepared.from as string, "latest");
  } catch (error) {
    pushWarning(
      warnings,
      "transaction.prepare.balance_unavailable",
      "Failed to fetch account balance.",
      { method: "eth_getBalance", blockTag: "latest", error: readErrorMessage(error) },
      { severity: "medium" },
    );
    return;
  }

  if (!balanceHex) {
    pushWarning(
      warnings,
      "transaction.prepare.balance_unavailable",
      "Failed to fetch account balance.",
      { method: "eth_getBalance", blockTag: "latest" },
      { severity: "medium" },
    );
    return;
  }

  const balanceWei = toBigIntOrNull(balanceHex);
  if (balanceWei === null) {
    pushWarning(
      warnings,
      "transaction.prepare.balance_unavailable",
      "Failed to parse account balance from RPC.",
      { method: "eth_getBalance", blockTag: "latest", balance: balanceHex },
      { severity: "medium" },
    );
    return;
  }

  if (balanceWei < requiredWei) {
    const deficitWei = requiredWei - balanceWei;
    pushIssue(
      issues,
      "transaction.prepare.insufficient_funds",
      "Insufficient funds for transaction.",
      {
        balance: balanceHex,
        required: Hex.fromNumber(requiredWei),
        deficit: Hex.fromNumber(deficitWei),
        value: prepared.value ?? "0x0",
        gasLimit: gasHex,
        feePerGas: feePerGasHex,
        additionalFee: additionalFeeWei > 0n ? Hex.fromNumber(additionalFeeWei) : "0x0",
        balanceBlockTag: "latest",
      },
      { severity: "high" },
    );
  }
};
