import * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/clients/eip155/eip155.js";
import type { Eip155DraftPrepared, Eip155DraftSummary, Eip155TransactionDraft, FeeResolutionResult } from "../types.js";
import { parseHexQuantity, pushIssue, readErrorMessage } from "../utils/validation.js";

type FeeResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  gas?: Hex.Hex;
  value?: Hex.Hex;
  feeValues: Partial<Pick<Eip155DraftPrepared, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
  payloadFees: Partial<Pick<Eip155DraftPrepared, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
};

const computeMaxCost = (
  feeMode: Eip155DraftSummary["feeMode"],
  gas: Hex.Hex | undefined,
  value: Hex.Hex | undefined,
  gasPrice: Hex.Hex | null,
  maxFeePerGas: Hex.Hex | null,
): { wei: string; hex: Hex.Hex } | null => {
  try {
    const gasAmount = gas ? Hex.toBigInt(gas) : null;
    let gasCost = BigInt(0);

    if (gasAmount) {
      if (feeMode === "legacy" && gasPrice) {
        gasCost = gasAmount * Hex.toBigInt(gasPrice);
      } else if (feeMode === "eip1559" && maxFeePerGas) {
        gasCost = gasAmount * Hex.toBigInt(maxFeePerGas);
      }
    }

    const valueAmount = value ? Hex.toBigInt(value) : BigInt(0);
    const total = gasCost + valueAmount;
    if (total === BigInt(0)) return null;

    return { wei: total.toString(10), hex: Hex.fromNumber(total) };
  } catch {
    return null;
  }
};

export const deriveFees = async (
  params: FeeResolverParams,
  issues: Eip155TransactionDraft["issues"],
): Promise<FeeResolutionResult> => {
  const preparedPatch: FeeResolutionResult["prepared"] = {};
  const summaryPatch: FeeResolutionResult["summary"] = {};

  const payloadGasPrice = params.payloadFees.gasPrice ?? null;
  const payloadMaxFee = params.payloadFees.maxFeePerGas ?? null;
  const payloadPriorityFee = params.payloadFees.maxPriorityFeePerGas ?? null;

  if (payloadGasPrice && (payloadMaxFee || payloadPriorityFee)) {
    pushIssue(issues, "transaction.draft.fee_conflict", "Cannot mix legacy gasPrice with EIP-1559 fields.", {
      gasPrice: payloadGasPrice,
      maxFeePerGas: payloadMaxFee,
      maxPriorityFeePerGas: payloadPriorityFee,
    });
  }

  if ((payloadMaxFee && !payloadPriorityFee) || (!payloadMaxFee && payloadPriorityFee)) {
    pushIssue(
      issues,
      "transaction.draft.fee_pair_incomplete",
      "EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.",
      { maxFeePerGas: payloadMaxFee, maxPriorityFeePerGas: payloadPriorityFee },
    );
  }

  let feeMode: Eip155DraftSummary["feeMode"] = "unknown";
  let gasPrice = params.feeValues.gasPrice ?? null;
  let maxFee = params.feeValues.maxFeePerGas ?? null;
  let priorityFee = params.feeValues.maxPriorityFeePerGas ?? null;

  if (payloadGasPrice && !payloadMaxFee && !payloadPriorityFee) {
    feeMode = "legacy";
  } else if (payloadMaxFee && payloadPriorityFee && !payloadGasPrice) {
    feeMode = "eip1559";
  } else if (!payloadGasPrice && !payloadMaxFee && !payloadPriorityFee && params.rpc) {
    try {
      const feeData = await params.rpc.getFeeData();
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        const fetchedMaxFee = parseHexQuantity(issues, feeData.maxFeePerGas, "maxFeePerGas");
        const fetchedPriorityFee = parseHexQuantity(issues, feeData.maxPriorityFeePerGas, "maxPriorityFeePerGas");
        if (fetchedMaxFee && fetchedPriorityFee) {
          feeMode = "eip1559";
          maxFee = fetchedMaxFee;
          priorityFee = fetchedPriorityFee;
          preparedPatch.maxFeePerGas = fetchedMaxFee;
          preparedPatch.maxPriorityFeePerGas = fetchedPriorityFee;
        }
      } else if (feeData.gasPrice) {
        const fetchedGasPrice = parseHexQuantity(issues, feeData.gasPrice, "gasPrice");
        if (fetchedGasPrice) {
          feeMode = "legacy";
          gasPrice = fetchedGasPrice;
          preparedPatch.gasPrice = fetchedGasPrice;
        }
      } else {
        pushIssue(issues, "transaction.draft.fee_estimation_empty", "RPC fee data response is empty.", {
          method: "eth_getBlockByNumber | eth_gasPrice",
        });
      }
    } catch (error) {
      pushIssue(issues, "transaction.draft.fee_estimation_failed", "Failed to fetch fee data.", {
        method: "eth_feeHistory | eth_gasPrice",
        error: readErrorMessage(error),
      });
    }
  }

  if (feeMode === "legacy" && gasPrice) {
    summaryPatch.fee = { mode: "legacy", gasPrice };
  } else if (feeMode === "eip1559" && maxFee && priorityFee) {
    summaryPatch.fee = { mode: "eip1559", maxFeePerGas: maxFee, maxPriorityFeePerGas: priorityFee };
  }

  const maxCost = computeMaxCost(feeMode, params.gas, params.value, gasPrice, maxFee);
  if (maxCost) {
    summaryPatch.maxCostWei = maxCost.wei;
    summaryPatch.maxCostHex = maxCost.hex;
  }

  summaryPatch.feeMode = feeMode;

  return { prepared: preparedPatch, summary: summaryPatch };
};
