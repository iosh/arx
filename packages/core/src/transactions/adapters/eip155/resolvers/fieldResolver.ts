import * as Hex from "ox/Hex";
import type { Eip155TransactionPayload } from "../../../../controllers/transaction/types.js";
import type { TransactionAdapterContext } from "../../types.js";
import type { Eip155TransactionDraft, FieldResolutionResult } from "../types.js";
import { deriveExpectedChainId } from "../utils/chainHelpers.js";
import { parseHexData, parseHexQuantity, pushIssue, pushWarning } from "../utils/validation.js";

export const deriveFields = (
  context: TransactionAdapterContext,
  payload: Eip155TransactionPayload,
  issues: Eip155TransactionDraft["issues"],
  warnings: Eip155TransactionDraft["warnings"],
): FieldResolutionResult => {
  const prepared: FieldResolutionResult["prepared"] = {};
  const summary: FieldResolutionResult["summary"] = {};
  const payloadValues: FieldResolutionResult["payloadValues"] = {};

  const expectedChainId = deriveExpectedChainId(context.chainRef);
  if (expectedChainId) {
    summary.expectedChainId = expectedChainId;
  }

  if (payload.chainId) {
    const chainId = parseHexQuantity(issues, payload.chainId, "chainId");
    if (chainId) {
      prepared.chainId = chainId;
      summary.chainId = chainId;
      if (expectedChainId && chainId !== expectedChainId) {
        pushIssue(issues, "transaction.draft.chain_id_mismatch", "chainId does not match active chain.", {
          payloadChainId: chainId,
          expectedChainId,
        });
      }
    }
  } else {
    pushWarning(warnings, "transaction.draft.chain_id_missing", "Transaction payload is missing chainId.");
  }

  const valueHex = parseHexQuantity(issues, payload.value, "value");
  if (valueHex) {
    prepared.value = valueHex;
    summary.valueHex = valueHex;
    try {
      summary.valueWei = Hex.toBigInt(valueHex).toString(10);
    } catch {
      // ignore conversion edge cases
    }
  }

  const dataHex = parseHexData(issues, payload.data);
  if (dataHex) {
    prepared.data = dataHex;
    summary.data = dataHex;
  }

  const gasHex = parseHexQuantity(issues, payload.gas, "gas");
  if (gasHex) {
    prepared.gas = gasHex;
    summary.gas = gasHex;
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
    summary.nonce = nonceHex;
    payloadValues.nonce = nonceHex;
  }

  return { prepared, summary, payloadValues };
};
