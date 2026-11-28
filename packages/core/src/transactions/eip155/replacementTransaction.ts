import { fromNumber, type Hex } from "ox/Hex";
import type { TransactionReplacementType } from "../types.js";
import type * as Eip155 from "./types.js";

export const replacementFee = (previous: Hex, estimate: Hex): Hex => {
  const previousFee = BigInt(previous);
  // Round the 10% increase up to a whole wei.
  const increase = (previousFee + 9n) / 10n;
  const minimumFee = previousFee + (increase > 0n ? increase : 1n);
  const estimatedFee = BigInt(estimate);
  return fromNumber(estimatedFee > minimumFee ? estimatedFee : minimumFee);
};

export const createEip155ReplacementRequest = (input: {
  target: Eip155.SignableTransaction;
  type: TransactionReplacementType;
}): Eip155.TransactionRequest => {
  const target = input.target;
  const cancelling = input.type === "cancel";
  const fields = cancelling
    ? { to: target.from, value: "0x0" as const, data: "0x" as const }
    : { to: target.to, value: target.value, data: target.data, gas: target.gas };

  return target.type === "legacy"
    ? { ...fields, type: "legacy" }
    : { ...fields, type: target.type, accessList: cancelling ? [] : target.accessList };
};
