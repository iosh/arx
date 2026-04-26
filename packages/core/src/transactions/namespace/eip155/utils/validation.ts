import * as Hex from "ox/Hex";
import type { TransactionProposalError } from "../../types.js";

export class Eip155FieldParseError extends Error {
  readonly field: string;
  readonly reason: string;
  readonly value: string;
  readonly parseMessage: string;

  constructor(args: { field: string; reason: string; message: string; value: string; parseMessage: string }) {
    super(args.message);
    this.name = "Eip155FieldParseError";
    this.field = args.field;
    this.reason = args.reason;
    this.value = args.value;
    this.parseMessage = args.parseMessage;
  }

  toProposalError(): TransactionProposalError {
    return {
      reason: this.reason,
      message: this.message,
      data: {
        field: this.field,
        value: this.value,
        error: this.parseMessage,
      },
    };
  }
}

export const readErrorMessage = (value: unknown): string => {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message;
  }
  return String(value);
};

export const parseOptionalHexQuantity = (value: string | undefined, field: string): Hex.Hex | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  try {
    Hex.assert(trimmed as Hex.Hex, { strict: false });
    Hex.toBigInt(trimmed as Hex.Hex);
    return trimmed as Hex.Hex;
  } catch (error) {
    throw new Eip155FieldParseError({
      field,
      reason: "transaction.prepare.invalid_hex",
      message: `Transaction ${field} must be a 0x-prefixed hex quantity.`,
      value,
      parseMessage: readErrorMessage(error),
    });
  }
};

export const parseOptionalHexData = (value: string | undefined): Hex.Hex | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  try {
    Hex.assert(trimmed as Hex.Hex, { strict: false });
    if ((trimmed.length - 2) % 2 !== 0) {
      throw new Error("hex data must have even length.");
    }
    Hex.toBytes(trimmed as Hex.Hex);
    return trimmed as Hex.Hex;
  } catch (error) {
    throw new Eip155FieldParseError({
      field: "data",
      reason: "transaction.prepare.invalid_data",
      message: "Transaction data must be 0x-prefixed even-length hex.",
      value,
      parseMessage: readErrorMessage(error),
    });
  }
};

export const parseHexQuantityToBigInt = (value: string, field: string): bigint => {
  return Hex.toBigInt(parseOptionalHexQuantity(value, field) as Hex.Hex);
};
