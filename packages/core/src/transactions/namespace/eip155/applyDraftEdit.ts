import { ArxReasons, arxError } from "@arx/errors";
import type { Eip155TransactionRequest } from "../../types.js";
import type { Eip155TransactionDraftChange } from "./transactionTypes.js";
import type { Eip155DraftEditContext } from "./types.js";
import { Eip155FieldParseError, parseOptionalHexQuantity } from "./utils/validation.js";

const EDITABLE_FIELDS = new Set(["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFieldChange = (change: Eip155TransactionDraftChange) => {
  const field = change.field;
  if (!EDITABLE_FIELDS.has(field)) {
    throw new Error(`Unsupported transaction draft field "${String(change.field)}".`);
  }

  return {
    field,
    value: change.value,
  };
};

export const applyEip155TransactionDraftEdit = (context: Eip155DraftEditContext): Eip155TransactionRequest => {
  if (context.request.namespace !== "eip155") {
    throw new Error(`EIP-155 draft editor cannot edit namespace "${context.request.namespace}".`);
  }
  if (context.edit.namespace !== "eip155") {
    throw new Error(`EIP-155 draft editor received edit namespace "${context.edit.namespace}".`);
  }

  const payload: Eip155TransactionRequest["payload"] = isPlainObject(context.request.payload)
    ? { ...context.request.payload }
    : {};
  const assignEditableField = (
    target: Eip155TransactionRequest["payload"],
    field: Eip155TransactionDraftChange["field"],
    value: `0x${string}`,
  ) => {
    switch (field) {
      case "gas":
        target.gas = value;
        return;
      case "gasPrice":
        target.gasPrice = value;
        return;
      case "maxFeePerGas":
        target.maxFeePerGas = value;
        return;
      case "maxPriorityFeePerGas":
        target.maxPriorityFeePerGas = value;
        return;
      case "nonce":
        target.nonce = value;
        return;
    }
  };

  for (const change of context.edit.changes) {
    const { field, value } = readFieldChange(change);
    if (!value) {
      delete payload[field];
      continue;
    }

    let parsed: `0x${string}` | null;
    try {
      parsed = parseOptionalHexQuantity(value, field);
    } catch (error) {
      if (error instanceof Eip155FieldParseError) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: error.message,
          data: {
            code: error.reason,
            details: {
              field: error.field,
              value: error.value,
              error: error.parseMessage,
            },
          },
        });
      }
      throw error;
    }
    if (parsed == null) {
      delete payload[field];
      continue;
    }
    assignEditableField(payload, field, parsed);
  }

  if (payload.gasPrice && (payload.maxFeePerGas || payload.maxPriorityFeePerGas)) {
    throw new Error("Cannot mix legacy gasPrice with EIP-1559 fields.");
  }
  if (
    (payload.maxFeePerGas && !payload.maxPriorityFeePerGas) ||
    (!payload.maxFeePerGas && payload.maxPriorityFeePerGas)
  ) {
    throw new Error("EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.");
  }

  return {
    ...context.request,
    payload,
  };
};
