import type * as Hex from "ox/Hex";
import type { Eip155RpcCapabilities } from "../../../../rpc/clients/eip155/eip155.js";
import type { Eip155PreparedTransaction, Eip155PreparedTransactionResult, FeeResolutionResult } from "../types.js";
import { parseHexQuantity, pushIssue, readErrorMessage } from "../utils/validation.js";

type FeeResolverParams = {
  rpc: Eip155RpcCapabilities | null;
  gas?: Hex.Hex;
  value?: Hex.Hex;
  feeValues: Partial<Pick<Eip155PreparedTransaction, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
  payloadFees: Partial<Pick<Eip155PreparedTransaction, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
  /**
   * Only validate payload fee fields (no RPC lookups, no suggested fee patching).
   * Useful for early short-circuiting on malformed requests.
   */
  validateOnly?: boolean;
};

export const deriveFees = async (
  params: FeeResolverParams,
  issues: Eip155PreparedTransactionResult["issues"],
): Promise<FeeResolutionResult> => {
  const preparedPatch: FeeResolutionResult["prepared"] = {};

  const payloadGasPrice = params.payloadFees.gasPrice ?? null;
  const payloadMaxFee = params.payloadFees.maxFeePerGas ?? null;
  const payloadPriorityFee = params.payloadFees.maxPriorityFeePerGas ?? null;

  if (payloadGasPrice && (payloadMaxFee || payloadPriorityFee)) {
    pushIssue(
      issues,
      "transaction.prepare.fee_conflict",
      "Cannot mix legacy gasPrice with EIP-1559 fields.",
      {
        gasPrice: payloadGasPrice,
        maxFeePerGas: payloadMaxFee,
        maxPriorityFeePerGas: payloadPriorityFee,
      },
      { severity: "high" },
    );
  }

  if ((payloadMaxFee && !payloadPriorityFee) || (!payloadMaxFee && payloadPriorityFee)) {
    pushIssue(
      issues,
      "transaction.prepare.fee_pair_incomplete",
      "EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.",
      { maxFeePerGas: payloadMaxFee, maxPriorityFeePerGas: payloadPriorityFee },
      { severity: "high" },
    );
  }

  if (params.validateOnly) {
    return { prepared: preparedPatch };
  }

  const hasPayloadFeeFields = Boolean(payloadGasPrice || payloadMaxFee || payloadPriorityFee);
  if (!hasPayloadFeeFields && params.rpc) {
    try {
      const feeData = await params.rpc.getFeeData();
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        const fetchedMaxFee = parseHexQuantity(issues, feeData.maxFeePerGas, "maxFeePerGas");
        const fetchedPriorityFee = parseHexQuantity(issues, feeData.maxPriorityFeePerGas, "maxPriorityFeePerGas");
        if (fetchedMaxFee && fetchedPriorityFee) {
          preparedPatch.maxFeePerGas = fetchedMaxFee;
          preparedPatch.maxPriorityFeePerGas = fetchedPriorityFee;
        }
      } else if (feeData.gasPrice) {
        const fetchedGasPrice = parseHexQuantity(issues, feeData.gasPrice, "gasPrice");
        if (fetchedGasPrice) {
          preparedPatch.gasPrice = fetchedGasPrice;
        }
      } else {
        pushIssue(issues, "transaction.prepare.fee_estimation_empty", "RPC fee data response is empty.", {
          method: "eth_getBlockByNumber | eth_gasPrice",
        });
      }
    } catch (error) {
      pushIssue(issues, "transaction.prepare.fee_estimation_failed", "Failed to fetch fee data.", {
        method: "eth_feeHistory | eth_gasPrice",
        error: readErrorMessage(error),
      });
    }
  }

  return { prepared: preparedPatch };
};
