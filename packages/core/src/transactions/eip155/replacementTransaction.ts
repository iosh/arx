import type { Hex } from "ox/Hex";
import * as HexNumber from "../../utils/hex.js";
import type { TransactionReplacementType } from "../types.js";
import type * as Eip155 from "./types.js";

const CANCEL_GAS = "0x5208" as Hex;
const BUMP_NUMERATOR = 11n;
const BUMP_DENOMINATOR = 10n;

const increaseFee = (value: Hex): Hex => {
  const current = HexNumber.toBigInt(value);
  const scaled = current * BUMP_NUMERATOR;
  const roundedUp = (scaled + BUMP_DENOMINATOR - 1n) / BUMP_DENOMINATOR;
  return HexNumber.fromNumber(roundedUp > current ? roundedUp : current + 1n);
};

export const createEip155ReplacementRequest = (input: {
  target: Eip155.Transaction;
  type: TransactionReplacementType;
  from: string;
}): Eip155.TransactionRequest => {
  const target = input.target.transaction;
  const cancelling = input.type === "cancel";
  const replacement = {
    to: cancelling ? input.from : target.to,
    value: cancelling ? ("0x0" as Hex) : target.value,
    data: cancelling ? ("0x" as Hex) : target.data,
    gas: cancelling ? CANCEL_GAS : target.gas,
    nonce: target.nonce,
  };

  switch (target.type) {
    case "legacy":
      return {
        ...replacement,
        type: "legacy",
        gasPrice: increaseFee(target.gasPrice),
      };
    case "eip2930":
      return {
        ...replacement,
        type: "eip2930",
        gasPrice: increaseFee(target.gasPrice),
        accessList: cancelling ? [] : target.accessList,
      };
    case "eip1559":
      return {
        ...replacement,
        type: "eip1559",
        maxFeePerGas: increaseFee(target.maxFeePerGas),
        maxPriorityFeePerGas: increaseFee(target.maxPriorityFeePerGas),
        accessList: cancelling ? [] : target.accessList,
      };
  }
};
