import { ArxReasons, arxError } from "@arx/errors";
import * as Hash from "ox/Hash";
import type { Hex as HexType } from "ox/Hex";
import * as Hex from "ox/Hex";
import * as PersonalMessage from "ox/PersonalMessage";
import * as TransactionEnvelopeEip1559 from "ox/TransactionEnvelopeEip1559";
import * as TransactionEnvelopeLegacy from "ox/TransactionEnvelopeLegacy";
import * as TypedData from "ox/TypedData";
import { eip155Codec } from "../../../accounts/addressing/codec.js";
import { parseChainRef } from "../../../chains/caip.js";
import type { AccountSigningService } from "../../../services/runtime/accountSigning.js";
import type { SignedTransactionPayload, TransactionSignContext } from "../types.js";
import type { Eip155PreparedTransaction } from "./types.js";

const textEncoder = new TextEncoder();

type SignerDeps = {
  accountSigning: Pick<AccountSigningService, "assertAccountUnlocked" | "signDigestByAccountKey">;
};

export type Eip155Signer = {
  signTransaction: (
    context: TransactionSignContext,
    prepared: Record<string, unknown>,
  ) => Promise<SignedTransactionPayload>;
  signPersonalMessage: (params: { accountKey: string; message: HexType | string }) => Promise<HexType>;
  signTypedData: (params: { accountKey: string; typedData: string }) => Promise<HexType>;
};

type ParsedSignature = {
  r: bigint;
  s: bigint;
  yParity: number;
  bytes: Uint8Array;
};

const readErrorMessage = (value: unknown) => {
  if (value instanceof Error && typeof value.message === "string") {
    return value.message;
  }
  return String(value);
};

const isHexValue = (value: unknown): value is HexType => typeof value === "string" && value.startsWith("0x");

function toBigInt(value: HexType | null | undefined, label: string, required: true): bigint;
function toBigInt(value: HexType | null | undefined, label: string, required?: false): bigint | undefined;
function toBigInt(value: HexType | null | undefined, label: string, required = false): bigint | undefined {
  if (value == null) {
    if (required) {
      throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: `Transaction ${label} is required.` });
    }
    return undefined;
  }
  try {
    Hex.assert(value, { strict: false });
    return Hex.toBigInt(value);
  } catch {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Transaction ${label} is not a valid hex quantity.`,
    });
  }
}

/**
 * Extract numeric chainId from transaction or context.
 * Validates chainId is a positive 53-bit safe integer.
 */
const deriveChainId = (context: TransactionSignContext, prepared: Record<string, unknown>): number => {
  if (prepared.chainId) {
    const numeric = Number(Hex.toBigInt(prepared.chainId as Hex.Hex));
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: "Transaction chainId must be a positive 53-bit integer.",
      });
    }
    return numeric;
  }

  const { namespace, reference } = parseChainRef(context.chainRef);
  if (namespace !== "eip155") {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Namespace "${namespace}" does not support Ethereum signing.`,
    });
  }

  const fallback = Number.parseInt(reference, 10);
  if (!Number.isSafeInteger(fallback) || fallback <= 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Active chainRef "${context.chainRef}" cannot provide a numeric chainId.`,
    });
  }
  return fallback;
};

const buildEnvelope = (
  prepared: Eip155PreparedTransaction,
  chainId: number,
):
  | { type: "eip1559"; value: TransactionEnvelopeEip1559.TransactionEnvelopeEip1559 }
  | { type: "legacy"; value: TransactionEnvelopeLegacy.TransactionEnvelopeLegacy } => {
  const base = {
    chainId,
    nonce: toBigInt(prepared.nonce, "nonce"),
    to: prepared.to ?? undefined,
    data: prepared.data ?? undefined,
    value: toBigInt(prepared.value, "value"),
    gas: toBigInt(prepared.gas, "gas"),
  };

  const has1559Fees = prepared.maxFeePerGas != null || prepared.maxPriorityFeePerGas != null;

  if (has1559Fees) {
    const maxFeePerGas = toBigInt(prepared.maxFeePerGas, "maxFeePerGas", true);
    const maxPriorityFeePerGas = toBigInt(prepared.maxPriorityFeePerGas, "maxPriorityFeePerGas", true);

    return {
      type: "eip1559",
      value: TransactionEnvelopeEip1559.from({
        ...base,
        type: "eip1559",
        maxFeePerGas,
        maxPriorityFeePerGas,
      }),
    };
  }

  const gasPrice = toBigInt(prepared.gasPrice, "gasPrice", true);

  return {
    type: "legacy",
    value: TransactionEnvelopeLegacy.from({
      ...base,
      type: "legacy",
      gasPrice,
    }),
  };
};

const composeSignatureHex = ({ bytes, yParity }: ParsedSignature): HexType => {
  const output = new Uint8Array(65);
  output.set(bytes.subarray(0, 64), 0);
  output[64] = 27 + yParity;
  return Hex.from(output);
};

const toEip155AccountKey = (params: { chainRef: string; address: string }) => {
  const canonical = eip155Codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
  return eip155Codec.toAccountKey(canonical);
};

const toPersonalMessageHex = (message: HexType | string): HexType => {
  if (isHexValue(message)) {
    Hex.assert(message, { strict: false });
    return message;
  }
  if (typeof message === "string" && message.startsWith("0x")) {
    try {
      Hex.assert(message, { strict: false });
      return message;
    } catch {
      // Invalid hex - fall through to treat as UTF-8 text
    }
  }
  const bytes = textEncoder.encode(String(message));
  return Hex.from(bytes);
};

const parseTypedDataPayload = (raw: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Typed data payload must be valid JSON.",
      data: { error: readErrorMessage(error) },
    });
  }

  if (!parsed || typeof parsed !== "object") {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Typed data payload must be a JSON object.",
    });
  }

  try {
    TypedData.assert(parsed as TypedData.Definition<Record<string, unknown>, string>);
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Typed data payload failed validation.",
      data: { error: readErrorMessage(error) },
    });
  }

  return parsed as TypedData.Definition<Record<string, unknown>, string>;
};

export const createEip155Signer = ({ accountSigning }: SignerDeps): Eip155Signer => {
  const signTransaction: Eip155Signer["signTransaction"] = async (context, preparedInput) => {
    if (context.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `EIP-155 signer cannot handle namespace "${context.namespace}".`,
      });
    }

    const requestPayload = context.request.payload;
    const payloadFrom =
      requestPayload && typeof requestPayload === "object" ? (requestPayload as { from?: unknown }).from : undefined;
    if (typeof payloadFrom === "string" && payloadFrom.toLowerCase() !== context.from.toLowerCase()) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: "Transaction from address does not match approved account.",
        data: { payloadFrom, approvedFrom: context.from },
      });
    }

    const fromAccountKey = toEip155AccountKey({ chainRef: context.chainRef, address: context.from });
    await accountSigning.assertAccountUnlocked(fromAccountKey);
    const prepared = preparedInput as Eip155PreparedTransaction;
    const chainId = deriveChainId(context, preparedInput);
    const envelope = buildEnvelope(prepared, chainId);

    if (envelope.type === "eip1559") {
      const txSignPayload = TransactionEnvelopeEip1559.getSignPayload(envelope.value);
      const signature = await accountSigning.signDigestByAccountKey({
        accountKey: fromAccountKey,
        digest: Hex.toBytes(txSignPayload),
      });
      const signed = TransactionEnvelopeEip1559.from(envelope.value, {
        signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
      });
      const raw = TransactionEnvelopeEip1559.serialize(signed);
      return { raw };
    }

    const txSignPayload = TransactionEnvelopeLegacy.getSignPayload(envelope.value);
    const signature = await accountSigning.signDigestByAccountKey({
      accountKey: fromAccountKey,
      digest: Hex.toBytes(txSignPayload),
    });
    const signed = TransactionEnvelopeLegacy.from(envelope.value, {
      signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
    });
    const raw = TransactionEnvelopeLegacy.serialize(signed);
    return { raw };
  };

  const signPersonalMessage: Eip155Signer["signPersonalMessage"] = async ({ accountKey, message }) => {
    await accountSigning.assertAccountUnlocked(accountKey);

    const messageHex = toPersonalMessageHex(message);
    const payload = PersonalMessage.getSignPayload(messageHex);

    const signature = await accountSigning.signDigestByAccountKey({
      accountKey,
      digest: Hex.toBytes(payload),
    });
    return composeSignatureHex(signature);
  };

  const signTypedData: Eip155Signer["signTypedData"] = async ({ accountKey, typedData }) => {
    await accountSigning.assertAccountUnlocked(accountKey);

    const definition = parseTypedDataPayload(typedData);
    const encoded = TypedData.encode(definition);
    const digest = Hash.keccak256(encoded);

    const signature = await accountSigning.signDigestByAccountKey({
      accountKey,
      digest: Hex.toBytes(digest),
    });
    return composeSignatureHex(signature);
  };

  return {
    signTransaction,
    signPersonalMessage,
    signTypedData,
  };
};
