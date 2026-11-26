import { Hex, Solidity, TypedData } from "ox";
import { z } from "zod";
import { invalidDappParams } from "../../dappConnections/defineDappMethod.js";
import { RpcInvalidParamsError } from "../../dappConnections/errors.js";
import { parseDappAddress } from "./rpcHex.js";
import type { Eip155TypedData, Eip155TypedDataField, Eip155TypedDataValue } from "./signingRequest.js";

const TYPED_DATA_FIELD_SCHEMA = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
});

const TYPED_DATA_SCHEMA: z.ZodType<Eip155TypedData> = z.strictObject({
  types: z.record(z.string(), z.array(TYPED_DATA_FIELD_SCHEMA)),
  primaryType: z.string().min(1),
  domain: z.record(z.string(), z.json()),
  message: z.record(z.string(), z.json()),
});

export const decodeSignTypedDataV4Params = (params: unknown, method: string) => {
  if (!Array.isArray(params) || params.length !== 2) {
    throw invalidDappParams(method, "expected exactly an address and typed data payload.");
  }

  const address = parseDappAddress(params[0]);
  if (address === null) {
    throw invalidDappParams(method, "expected a valid EIP-155 account address.");
  }

  return { address, ...decodeTypedData(params[1], method) };
};

function decodeTypedData(value: unknown, method: string) {
  const parsed = TYPED_DATA_SCHEMA.parse(parseTypedDataJson(value, method));
  try {
    const signedData = projectTypedDataForSigning(parsed, method);
    const domainChainId = decodeDomainChainId(signedData.domain.chainId, method);

    const digest = TypedData.getSignPayload({
      ...signedData,
      domain: domainForSigning(signedData.domain, domainChainId),
    });

    // Approval data crosses a JSON channel; signing uses bigint, while display uses decimal text.
    const typedData = withDecimalChainId(signedData, domainChainId);
    return { typedData, domainChainId, digest };
  } catch (error) {
    if (error instanceof RpcInvalidParamsError) throw error;
    throw invalidTypedData(method);
  }
}

function parseTypedDataJson(value: unknown, method: string): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidDappParams(method, "typed data must be valid JSON.");
  }
}

function decodeDomainChainId(value: Eip155TypedDataValue | undefined, method: string): bigint | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    throw invalidDappParams(method, "domain.chainId must be a non-negative safe integer or integer string.");
  }

  if (typeof value !== "string") {
    throw invalidDappParams(method, "domain.chainId must be a non-negative integer.");
  }

  if (value !== "0x" && Hex.validate(value, { strict: true })) return BigInt(value);

  const decimalChainId = parseDecimalChainId(value);
  if (decimalChainId !== undefined) return decimalChainId;

  throw invalidDappParams(method, "domain.chainId must be a non-negative integer.");
}

function parseDecimalChainId(value: string): bigint | undefined {
  try {
    const chainId = BigInt(value);
    return chainId >= 0n && `${chainId}` === value ? chainId : undefined;
  } catch {
    return undefined;
  }
}

function withDecimalChainId(typedData: Eip155TypedData, chainId: bigint | undefined): Eip155TypedData {
  if (chainId === undefined) return typedData;

  return {
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: `${chainId}`,
    },
  };
}

function domainForSigning(
  domain: Eip155TypedData["domain"],
  chainId: bigint | undefined,
): Readonly<Record<string, unknown>> {
  return chainId === undefined ? domain : { ...domain, chainId };
}

const isTypedDataRecord = (value: Eip155TypedDataValue): value is Readonly<Record<string, Eip155TypedDataValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Properties outside the EIP-712 type graph are not signed, so omit them from the approval payload.
function projectTypedDataForSigning(typedData: Eip155TypedData, method: string): Eip155TypedData {
  const { types } = typedData;
  const fieldsFor = (type: string): readonly Eip155TypedDataField[] | undefined =>
    Object.hasOwn(types, type) ? types[type] : undefined;

  function projectValue(value: Eip155TypedDataValue, type: string): Eip155TypedDataValue {
    const arrayType = Solidity.arrayRegex.exec(type);
    if (arrayType) {
      const itemType = arrayType[1];
      const fixedLength = arrayType[2];
      if (!itemType || fixedLength === undefined || !Array.isArray(value)) throw invalidTypedData(method);
      if (fixedLength !== "" && BigInt(value.length) !== BigInt(fixedLength)) throw invalidTypedData(method);

      return value.map((item) => projectValue(item, itemType));
    }

    const fields = fieldsFor(type);
    if (!fields) return value;
    if (!isTypedDataRecord(value)) throw invalidTypedData(method);

    return projectFields(value, fields);
  }

  function projectFields(
    values: Readonly<Record<string, Eip155TypedDataValue>>,
    fields: readonly Eip155TypedDataField[],
  ): Readonly<Record<string, Eip155TypedDataValue>> {
    return Object.fromEntries(
      fields.map((field) => {
        if (!Object.hasOwn(values, field.name)) throw invalidTypedData(method);
        return [field.name, projectValue(values[field.name] as Eip155TypedDataValue, field.type)];
      }),
    );
  }

  const messageFields = fieldsFor(typedData.primaryType);
  if (!messageFields) throw invalidTypedData(method);

  const domainFields = fieldsFor("EIP712Domain");
  if (!domainFields) {
    throw invalidDappParams(method, "types.EIP712Domain must explicitly declare the signed domain fields.");
  }

  return {
    types,
    primaryType: typedData.primaryType,
    domain: projectFields(typedData.domain, domainFields),
    // Ox omits the message hash when the primary type is EIP712Domain.
    message: typedData.primaryType === "EIP712Domain" ? {} : projectFields(typedData.message, messageFields),
  };
}

function invalidTypedData(method: string): RpcInvalidParamsError {
  return invalidDappParams(method, "typed data does not conform to EIP-712.");
}
