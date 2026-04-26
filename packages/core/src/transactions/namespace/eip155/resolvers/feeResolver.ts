import type { Eip155FeeOracle } from "../feeOracle.js";
import type { Eip155PreparedTransaction, Eip155PrepareStepResult, FeeResolutionResult } from "../types.js";
import { Eip155FieldParseError, parseOptionalHexQuantity, readErrorMessage } from "../utils/validation.js";

type FeeResolverParams = {
  feeOracle: Eip155FeeOracle | null;
  payloadFees: Partial<Pick<Eip155PreparedTransaction, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
};

export const deriveFees = async (
  params: FeeResolverParams,
): Promise<Eip155PrepareStepResult<FeeResolutionResult["prepared"]>> => {
  const preparedPatch: FeeResolutionResult["prepared"] = {};
  const payloadGasPrice = params.payloadFees.gasPrice ?? null;
  const payloadMaxFee = params.payloadFees.maxFeePerGas ?? null;
  const payloadPriorityFee = params.payloadFees.maxPriorityFeePerGas ?? null;

  const hasPayloadFeeFields = Boolean(payloadGasPrice || payloadMaxFee || payloadPriorityFee);
  if (!hasPayloadFeeFields && params.feeOracle) {
    try {
      const suggestion = await params.feeOracle.suggestFees();
      if (suggestion.mode === "eip1559") {
        const fetchedMaxFee = parseOptionalHexQuantity(suggestion.maxFeePerGas, "maxFeePerGas");
        const fetchedPriorityFee = parseOptionalHexQuantity(suggestion.maxPriorityFeePerGas, "maxPriorityFeePerGas");
        if (fetchedMaxFee && fetchedPriorityFee) {
          preparedPatch.maxFeePerGas = fetchedMaxFee;
          preparedPatch.maxPriorityFeePerGas = fetchedPriorityFee;
        }
      } else {
        const fetchedGasPrice = parseOptionalHexQuantity(suggestion.gasPrice, "gasPrice");
        if (fetchedGasPrice) {
          preparedPatch.gasPrice = fetchedGasPrice;
        }
      }
    } catch (error) {
      if (error instanceof Eip155FieldParseError) {
        return { status: "failed", error: error.toProposalError(), patch: preparedPatch };
      }
      return {
        status: "failed",
        error: {
          reason: "transaction.prepare.fee_estimation_failed",
          message: "Failed to fetch fee data.",
          data: {
            method: "feeOracle.suggestFees",
            error: readErrorMessage(error),
          },
        },
        patch: preparedPatch,
      };
    }
  }

  return { status: "ok", patch: preparedPatch };
};
