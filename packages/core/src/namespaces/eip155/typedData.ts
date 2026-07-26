import { Hex, Solidity, TypedData } from "ox";
import { z } from "zod";
import { invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import { RpcInvalidParamsError } from "../../rpc/errors.js";
import { isEip155Address } from "./address.js";
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

  const address = params[0];
  if (typeof address !== "string" || !isEip155Address(address)) {
    throw invalidDappParams(method, "expected a valid EIP-155 account address.");
  }

  return { address, ...decodeTypedData(params[1], method) };
};

function decodeTypedData(value: unknown, method: string) {
  const parsed = TYPED_DATA_SCHEMA.parse(parseTypedDataJson(value, method));
  const decodedDomainChainId = decodeDomainChainId(parsed.domain.chainId, method);

  try {
    const typedData = projectTypedDataForSigning(
      withDecimalChainId(parsed, decodedDomainChainId),
      decodedDomainChainId,
      method,
    );
    const domainChainId = Object.hasOwn(typedData.domain, "chainId") ? decodedDomainChainId : undefined;
    const digest = TypedData.getSignPayload({
      types: typedData.types,
      primaryType: typedData.primaryType,
      domain: domainForSigning(typedData.domain, domainChainId),
      message: typedData.message,
    });
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
    return chainId >= 0n && chainId.toString(10) === value ? chainId : undefined;
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
      chainId: chainId.toString(10),
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
function projectTypedDataForSigning(
  typedData: Eip155TypedData,
  domainChainId: bigint | undefined,
  method: string,
): Eip155TypedData {
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

  const domainFields =
    fieldsFor("EIP712Domain") ?? TypedData.extractEip712DomainTypes(domainForSigning(typedData.domain, domainChainId));

  return {
    types,
    primaryType: typedData.primaryType,
    domain: projectFields(typedData.domain, domainFields),
    message: projectFields(typedData.message, messageFields),
  };
}

function invalidTypedData(method: string): RpcInvalidParamsError {
  return invalidDappParams(method, "typed data does not conform to EIP-712.");
}
