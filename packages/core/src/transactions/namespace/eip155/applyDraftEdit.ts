import { ArxReasons, arxError } from "@arx/errors";
import type { TransactionRequest } from "../../types.js";
import type { TransactionDraftEditContext } from "../types.js";
import { Eip155FieldParseError, parseOptionalHexQuantity } from "./utils/validation.js";

const EDITABLE_FIELDS = new Set(["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFieldChange = (change: Record<string, unknown>) => {
  const field = typeof change.field === "string" ? change.field : null;
  if (!field || !EDITABLE_FIELDS.has(field)) {
    throw new Error(`Unsupported transaction draft field "${String(change.field)}".`);
  }

  return {
    field,
    value: typeof change.value === "string" ? change.value : null,
  };
};

export const applyEip155TransactionDraftEdit = (context: TransactionDraftEditContext): TransactionRequest => {
  if (context.request.namespace !== "eip155") {
    throw new Error(`EIP-155 draft editor cannot edit namespace "${context.request.namespace}".`);
  }

  const payload = isPlainObject(context.request.payload) ? { ...context.request.payload } : {};

  for (const change of context.changes) {
    const { field, value } = readFieldChange(change);
    if (!value) {
      delete payload[field];
      continue;
    }

    let parsed: string | null;
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
    payload[field] = parsed;
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
