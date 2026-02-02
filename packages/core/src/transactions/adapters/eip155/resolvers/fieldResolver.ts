import * as Hex from "ox/Hex";
import type { Eip155TransactionPayload } from "../../../../controllers/transaction/types.js";
import type { TransactionAdapterContext } from "../../types.js";
import type { Eip155PreparedTransactionResult, FieldResolutionResult } from "../types.js";
import { deriveExpectedChainId } from "../utils/chainHelpers.js";
import { parseHexData, parseHexQuantity, pushIssue, pushWarning } from "../utils/validation.js";

export const deriveFields = (
  context: TransactionAdapterContext,
  payload: Eip155TransactionPayload,
  issues: Eip155PreparedTransactionResult["issues"],
  warnings: Eip155PreparedTransactionResult["warnings"],
): FieldResolutionResult => {
  const prepared: FieldResolutionResult["prepared"] = {};
  const payloadValues: FieldResolutionResult["payloadValues"] = {};

  const expectedChainId = deriveExpectedChainId(context.chainRef);

  if (payload.chainId) {
    const chainId = parseHexQuantity(issues, payload.chainId, "chainId");
    if (chainId) {
      prepared.chainId = chainId;
      if (expectedChainId && chainId !== expectedChainId) {
        pushIssue(issues, "transaction.prepare.chain_id_mismatch", "chainId does not match active chain.", {
          payloadChainId: chainId,
          expectedChainId,
        });
      }
    }
  } else {
    pushWarning(warnings, "transaction.prepare.chain_id_missing", "Transaction payload is missing chainId.");
  }

  const valueHex = parseHexQuantity(issues, payload.value, "value");
  if (valueHex) {
    prepared.value = valueHex;
  }

  const dataHex = parseHexData(issues, payload.data);
  if (dataHex) {
    prepared.data = dataHex;
  }

  const gasHex = parseHexQuantity(issues, payload.gas, "gas");
  if (gasHex) {
    prepared.gas = gasHex;
    payloadValues.gas = gasHex;
  }

  const gasPriceHex = parseHexQuantity(issues, payload.gasPrice, "gasPrice");
  if (gasPriceHex) {
    prepared.gasPrice = gasPriceHex;
    payloadValues.gasPrice = gasPriceHex;
  }

  const maxFeeHex = parseHexQuantity(issues, payload.maxFeePerGas, "maxFeePerGas");
  if (maxFeeHex) {
    prepared.maxFeePerGas = maxFeeHex;
    payloadValues.maxFeePerGas = maxFeeHex;
  }

  const priorityFeeHex = parseHexQuantity(issues, payload.maxPriorityFeePerGas, "maxPriorityFeePerGas");
  if (priorityFeeHex) {
    prepared.maxPriorityFeePerGas = priorityFeeHex;
    payloadValues.maxPriorityFeePerGas = priorityFeeHex;
  }

  const nonceHex = parseHexQuantity(issues, payload.nonce, "nonce");
  if (nonceHex) {
    prepared.nonce = nonceHex;
    payloadValues.nonce = nonceHex;
  }

  return { prepared, payloadValues };
};
