import type { Eip155TransactionPayload } from "../../../types.js";
import type { TransactionPrepareContext } from "../../types.js";
import type { Eip155PrepareStepResult, FieldResolutionResult } from "../types.js";
import { deriveExpectedChainId } from "../utils/chainHelpers.js";
import { Eip155FieldParseError, parseOptionalHexData, parseOptionalHexQuantity } from "../utils/validation.js";

export const deriveFields = (
  context: TransactionPrepareContext,
  payload: Eip155TransactionPayload,
): Eip155PrepareStepResult<FieldResolutionResult> => {
  const prepared: FieldResolutionResult["prepared"] = {};
  const payloadValues: FieldResolutionResult["payloadValues"] = {};

  const expectedChainId = deriveExpectedChainId(context.chainRef);

  try {
    if (payload.chainId) {
      const chainId = parseOptionalHexQuantity(payload.chainId, "chainId");
      if (chainId) {
        prepared.chainId = expectedChainId && chainId !== expectedChainId ? expectedChainId : chainId;
      }
    }

    const valueHex = parseOptionalHexQuantity(payload.value, "value");
    if (valueHex) {
      prepared.value = valueHex;
    }

    const dataHex = parseOptionalHexData(payload.data);
    if (dataHex) {
      prepared.data = dataHex;
    }

    const gasHex = parseOptionalHexQuantity(payload.gas, "gas");
    if (gasHex) {
      prepared.gas = gasHex;
      payloadValues.gas = gasHex;
    }

    const gasPriceHex = parseOptionalHexQuantity(payload.gasPrice, "gasPrice");
    if (gasPriceHex) {
      prepared.gasPrice = gasPriceHex;
      payloadValues.gasPrice = gasPriceHex;
    }

    const maxFeeHex = parseOptionalHexQuantity(payload.maxFeePerGas, "maxFeePerGas");
    if (maxFeeHex) {
      prepared.maxFeePerGas = maxFeeHex;
      payloadValues.maxFeePerGas = maxFeeHex;
    }

    const priorityFeeHex = parseOptionalHexQuantity(payload.maxPriorityFeePerGas, "maxPriorityFeePerGas");
    if (priorityFeeHex) {
      prepared.maxPriorityFeePerGas = priorityFeeHex;
      payloadValues.maxPriorityFeePerGas = priorityFeeHex;
    }

    const nonceHex = parseOptionalHexQuantity(payload.nonce, "nonce");
    if (nonceHex) {
      prepared.nonce = nonceHex;
      payloadValues.nonce = nonceHex;
    }
  } catch (error) {
    if (!(error instanceof Eip155FieldParseError)) {
      throw error;
    }
    return {
      status: "failed",
      error: error.toProposalError(),
      patch: {
        prepared,
        payloadValues,
      },
    };
  }

  return {
    status: "ok",
    patch: {
      prepared,
      payloadValues,
    },
  };
};
