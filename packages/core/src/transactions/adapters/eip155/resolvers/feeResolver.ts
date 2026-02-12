import type { Eip155FeeOracle } from "../feeOracle.js";
import type { Eip155PreparedTransaction, Eip155PreparedTransactionResult, FeeResolutionResult } from "../types.js";
import { parseHexQuantity, pushIssue, readErrorMessage } from "../utils/validation.js";

type FeeResolverParams = {
  feeOracle: Eip155FeeOracle | null;
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
  if (!hasPayloadFeeFields && params.feeOracle) {
    try {
      const suggestion = await params.feeOracle.suggestFees();
      if (suggestion.mode === "eip1559") {
        const fetchedMaxFee = parseHexQuantity(issues, suggestion.maxFeePerGas, "maxFeePerGas");
        const fetchedPriorityFee = parseHexQuantity(issues, suggestion.maxPriorityFeePerGas, "maxPriorityFeePerGas");
        if (fetchedMaxFee && fetchedPriorityFee) {
          preparedPatch.maxFeePerGas = fetchedMaxFee;
          preparedPatch.maxPriorityFeePerGas = fetchedPriorityFee;
        }
      } else {
        const fetchedGasPrice = parseHexQuantity(issues, suggestion.gasPrice, "gasPrice");
        if (fetchedGasPrice) {
          preparedPatch.gasPrice = fetchedGasPrice;
        }
      }
    } catch (error) {
      pushIssue(issues, "transaction.prepare.fee_estimation_failed", "Failed to fetch fee data.", {
        method: "feeOracle.suggestFees",
        error: readErrorMessage(error),
      });
    }
  }

  return { prepared: preparedPatch };
};
