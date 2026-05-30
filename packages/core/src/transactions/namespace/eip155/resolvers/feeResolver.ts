import type { Eip155FeeOracle } from "../feeOracle.js";
import type { Eip155PrepareStepResult, FeeResolutionResult } from "../types.js";
import type { Eip155UnsignedTransactionDraft } from "../unsignedTransaction.js";
import { readErrorMessage } from "../utils/validation.js";

type FeeResolverParams = {
  feeOracle: Eip155FeeOracle | null;
  payloadFees: Partial<Pick<Eip155UnsignedTransactionDraft, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
};

export const deriveFees = async (
  params: FeeResolverParams,
): Promise<Eip155PrepareStepResult<FeeResolutionResult["prepared"]>> => {
  const payloadGasPrice = params.payloadFees.gasPrice ?? null;
  const payloadMaxFee = params.payloadFees.maxFeePerGas ?? null;
  const payloadPriorityFee = params.payloadFees.maxPriorityFeePerGas ?? null;

  if (payloadGasPrice) {
    return {
      status: "ok",
      patch: {
        gasPrice: payloadGasPrice,
      },
    };
  }

  if (payloadMaxFee && payloadPriorityFee) {
    return {
      status: "ok",
      patch: {
        maxFeePerGas: payloadMaxFee,
        maxPriorityFeePerGas: payloadPriorityFee,
      },
    };
  }

  if (!params.feeOracle) {
    return {
      status: "failed",
      error: {
        reason: "transaction.prepare.fee_unavailable",
        message: "Failed to resolve a complete fee configuration.",
      },
      patch: {},
    };
  }

  try {
    const suggestion = await params.feeOracle.suggestFees();
    if (suggestion.mode === "eip1559") {
      return {
        status: "ok",
        patch: {
          maxFeePerGas: suggestion.maxFeePerGas,
          maxPriorityFeePerGas: suggestion.maxPriorityFeePerGas,
        },
      };
    }

    return {
      status: "ok",
      patch: {
        gasPrice: suggestion.gasPrice,
      },
    };
  } catch (error) {
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
      patch: {},
    };
  }
};
