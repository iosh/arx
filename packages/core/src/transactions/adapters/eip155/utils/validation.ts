import * as Hex from "ox/Hex";
import type { Eip155TransactionDraft } from "../types.js";

export const readErrorMessage = (value: unknown): string => {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message;
  }
  return String(value);
};

export const pushIssue = (
  issues: Eip155TransactionDraft["issues"],
  code: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const entry: Eip155TransactionDraft["issues"][number] = { code, message };
  if (data) entry.data = data;
  issues.push(entry);
};

export const pushWarning = (
  warnings: Eip155TransactionDraft["warnings"],
  code: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const entry: Eip155TransactionDraft["warnings"][number] = { code, message };
  if (data) entry.data = data;
  warnings.push(entry);
};

export const parseHexQuantity = (
  issues: Eip155TransactionDraft["issues"],
  value: string | undefined,
  label: string,
): Hex.Hex | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  try {
    Hex.assert(trimmed as Hex.Hex, { strict: false });
    Hex.toBigInt(trimmed as Hex.Hex); // ensure all digits are valid
    return trimmed as Hex.Hex;
  } catch (error) {
    pushIssue(issues, "transaction.draft.invalid_hex", `${label} must be a 0x-prefixed hex quantity.`, {
      value,
      error: readErrorMessage(error),
    });
    return null;
  }
};

export const parseHexData = (issues: Eip155TransactionDraft["issues"], value: string | undefined): Hex.Hex | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  try {
    Hex.assert(trimmed as Hex.Hex, { strict: false });
    if ((trimmed.length - 2) % 2 !== 0) {
      throw new Error("hex data must have even length.");
    }
    Hex.toBytes(trimmed as Hex.Hex); // validate character set
    return trimmed as Hex.Hex;
  } catch (error) {
    pushIssue(issues, "transaction.draft.invalid_data", "data must be 0x-prefixed even-length hex.", {
      value,
      error: readErrorMessage(error),
    });
    return null;
  }
};
