import { Address, Hex } from "ox";
import type { AccessList } from "ox/AccessList";
import { z } from "zod";
import { invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type * as Eip155 from "../../transactions/eip155/types.js";
import { decodeChainId, decodeHexBytes, decodeHexNumber } from "./rpcHex.js";

const ACCESS_LIST_SCHEMA = z.array(
  z.strictObject({
    address: z.string(),
    storageKeys: z.array(z.string()),
  }),
);

const COMMON_TRANSACTION_FIELDS = {
  from: z.string(),
  to: z.string().nullable().optional(),
  value: z.string().optional(),
  data: z.string().optional(),
  gas: z.string().optional(),
  nonce: z.string().optional(),
  chainId: z.string().optional(),
  type: z.string().optional(),
} as const;

const TRANSACTION_DISCRIMINATOR_SCHEMA = z.tuple([
  z.looseObject({
    type: z.unknown().optional(),
    gasPrice: z.unknown().optional(),
    maxFeePerGas: z.unknown().optional(),
    maxPriorityFeePerGas: z.unknown().optional(),
    accessList: z.unknown().optional(),
  }),
]);

const AUTO_TRANSACTION_PARAMS_SCHEMA = z.tuple([z.strictObject(COMMON_TRANSACTION_FIELDS)]);
const LEGACY_TRANSACTION_PARAMS_SCHEMA = z.tuple([
  z.strictObject({
    ...COMMON_TRANSACTION_FIELDS,
    gasPrice: z.string().optional(),
  }),
]);
const EIP2930_TRANSACTION_PARAMS_SCHEMA = z.tuple([
  z.strictObject({
    ...COMMON_TRANSACTION_FIELDS,
    gasPrice: z.string().optional(),
    accessList: ACCESS_LIST_SCHEMA.optional(),
  }),
]);
const EIP1559_TRANSACTION_PARAMS_SCHEMA = z.tuple([
  z.strictObject({
    ...COMMON_TRANSACTION_FIELDS,
    maxFeePerGas: z.string().optional(),
    maxPriorityFeePerGas: z.string().optional(),
    accessList: ACCESS_LIST_SCHEMA.optional(),
  }),
]);

type TransactionKind = "auto" | "legacy" | "eip2930" | "eip1559";

type RpcTransactionFields = Readonly<{
  from: string;
  to?: string | null | undefined;
  value?: string | undefined;
  data?: string | undefined;
  gas?: string | undefined;
  nonce?: string | undefined;
  chainId?: string | undefined;
}>;

export type DecodedSendTransactionParams = Readonly<{
  from: string;
  transaction: Eip155.TransactionRequest;
  requestedChainRef: ChainRef | undefined;
}>;

const decodeAddress = (value: string, method: string, field: string): Address.Address => {
  if (!Address.validate(value, { strict: false })) {
    throw invalidDappParams(method, `${field} must be a valid 0x-prefixed EIP-155 address.`);
  }
  return value;
};

const decodeAccessList = (
  entries: z.infer<typeof ACCESS_LIST_SCHEMA> | undefined,
  method: string,
): AccessList | undefined => {
  if (entries === undefined) return undefined;

  return entries.map((entry, entryIndex) => ({
    address: decodeAddress(entry.address, method, `accessList[${entryIndex}].address`),
    storageKeys: entry.storageKeys.map((value, keyIndex) => {
      const storageKey = decodeHexBytes(value, method, `accessList[${entryIndex}].storageKeys[${keyIndex}]`);
      if (Hex.size(storageKey) !== 32) {
        throw invalidDappParams(method, `accessList[${entryIndex}].storageKeys[${keyIndex}] must be 32 bytes.`);
      }
      return storageKey;
    }),
  }));
};

const decodeCommonFields = (request: RpcTransactionFields, method: string) => ({
  from: decodeAddress(request.from, method, "from"),
  to: request.to === undefined || request.to === null ? request.to : decodeAddress(request.to, method, "to"),
  value: request.value === undefined ? undefined : decodeHexNumber(request.value, method, "value"),
  data: request.data === undefined ? undefined : decodeHexBytes(request.data, method, "data"),
  gas: request.gas === undefined ? undefined : decodeHexNumber(request.gas, method, "gas"),
  nonce: request.nonce === undefined ? undefined : decodeHexNumber(request.nonce, method, "nonce"),
  requestedChainRef: request.chainId === undefined ? undefined : decodeChainId(request.chainId, method).chainRef,
});

const decodeTransactionKind = (params: unknown, method: string): TransactionKind => {
  const [request] = TRANSACTION_DISCRIMINATOR_SCHEMA.parse(params);
  const type = request.type === undefined ? undefined : decodeHexNumber(request.type, method, "type");

  if (type === "0x0") return "legacy";
  if (type === "0x1") return "eip2930";
  if (type === "0x2") return "eip1559";
  if (type === "0x3") {
    throw invalidDappParams(method, "EIP-4844 transaction type 0x3 is not supported.");
  }
  if (type === "0x4") {
    throw invalidDappParams(method, "EIP-7702 transaction type 0x4 is not supported.");
  }
  if (type !== undefined) {
    throw invalidDappParams(method, `transaction type ${type} is not supported.`);
  }

  if (request.maxFeePerGas !== undefined || request.maxPriorityFeePerGas !== undefined) return "eip1559";
  if (request.accessList !== undefined) return "eip2930";
  if (request.gasPrice !== undefined) return "legacy";
  return "auto";
};

export const decodeSendTransactionParams = (params: unknown, method: string): DecodedSendTransactionParams => {
  switch (decodeTransactionKind(params, method)) {
    case "auto": {
      const [request] = AUTO_TRANSACTION_PARAMS_SCHEMA.parse(params);
      const { from, requestedChainRef, ...fields } = decodeCommonFields(request, method);
      return {
        from,
        requestedChainRef,
        transaction: {
          type: "auto",
          ...fields,
        },
      };
    }
    case "legacy": {
      const [request] = LEGACY_TRANSACTION_PARAMS_SCHEMA.parse(params);
      const { from, requestedChainRef, ...fields } = decodeCommonFields(request, method);
      return {
        from,
        requestedChainRef,
        transaction: {
          type: "legacy",
          ...fields,
          gasPrice: request.gasPrice === undefined ? undefined : decodeHexNumber(request.gasPrice, method, "gasPrice"),
        },
      };
    }
    case "eip2930": {
      const [request] = EIP2930_TRANSACTION_PARAMS_SCHEMA.parse(params);
      const { from, requestedChainRef, ...fields } = decodeCommonFields(request, method);
      return {
        from,
        requestedChainRef,
        transaction: {
          type: "eip2930",
          ...fields,
          gasPrice: request.gasPrice === undefined ? undefined : decodeHexNumber(request.gasPrice, method, "gasPrice"),
          accessList: decodeAccessList(request.accessList, method),
        },
      };
    }
    case "eip1559": {
      const [request] = EIP1559_TRANSACTION_PARAMS_SCHEMA.parse(params);
      const { from, requestedChainRef, ...fields } = decodeCommonFields(request, method);
      return {
        from,
        requestedChainRef,
        transaction: {
          type: "eip1559",
          ...fields,
          maxFeePerGas:
            request.maxFeePerGas === undefined
              ? undefined
              : decodeHexNumber(request.maxFeePerGas, method, "maxFeePerGas"),
          maxPriorityFeePerGas:
            request.maxPriorityFeePerGas === undefined
              ? undefined
              : decodeHexNumber(request.maxPriorityFeePerGas, method, "maxPriorityFeePerGas"),
          accessList: decodeAccessList(request.accessList, method),
        },
      };
    }
  }
};
