import { ArxReasons, arxError } from "@arx/errors";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as Hash from "ox/Hash";
import type { Hex as HexType } from "ox/Hex";
import * as Hex from "ox/Hex";
import * as PersonalMessage from "ox/PersonalMessage";
import * as TransactionEnvelopeEip1559 from "ox/TransactionEnvelopeEip1559";
import * as TransactionEnvelopeLegacy from "ox/TransactionEnvelopeLegacy";
import * as TypedData from "ox/TypedData";
import { parseChainRef } from "../../../chains/caip.js";
import type { KeyringService } from "../../../runtime/keyring/KeyringService.js";
import { zeroize } from "../../../vault/utils.js";
import type { SignedTransactionPayload, TransactionAdapterContext, TransactionDraft } from "../types.js";
import type { Eip155DraftPrepared, Eip155TransactionDraft } from "./types.js";

const textEncoder = new TextEncoder();

type SignerDeps = {
  keyring: Pick<KeyringService, "hasAccount" | "exportPrivateKeyForSigning">;
};

export type Eip155Signer = {
  signTransaction: (context: TransactionAdapterContext, draft: TransactionDraft) => Promise<SignedTransactionPayload>;
  signPersonalMessage: (params: { address: string; message: HexType | string }) => Promise<HexType>;
  signTypedData: (params: { address: string; typedData: string }) => Promise<HexType>;
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

const toBigInt = (value: HexType | null | undefined, label: string, required = false): bigint | undefined => {
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
};

/**
 * Extract numeric chainId from transaction or context.
 * Validates chainId is a positive 53-bit safe integer.
 */
const deriveChainId = (context: TransactionAdapterContext, prepared: Record<string, unknown>): number => {
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
  prepared: Eip155DraftPrepared,
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
    const maxFeePerGas = toBigInt(prepared.maxFeePerGas, "maxFeePerGas", true)!;
    const maxPriorityFeePerGas = toBigInt(prepared.maxPriorityFeePerGas, "maxPriorityFeePerGas", true)!;

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

  const gasPrice = toBigInt(prepared.gasPrice, "gasPrice", true)!;

  return {
    type: "legacy",
    value: TransactionEnvelopeLegacy.from({
      ...base,
      type: "legacy",
      gasPrice,
    }),
  };
};

const parseSignature = (payload: HexType, privateKey: Uint8Array): ParsedSignature => {
  const payloadBytes = Hex.toBytes(payload);

  const signature = secp256k1.sign(payloadBytes, privateKey, { lowS: true });

  const compactBytes = signature.toCompactRawBytes();

  return {
    r: signature.r,
    s: signature.s,
    yParity: signature.recovery ?? 0,
    bytes: compactBytes,
  };
};

const composeSignatureHex = ({ bytes, yParity }: ParsedSignature): HexType => {
  const output = new Uint8Array(65);
  output.set(bytes.subarray(0, 64), 0);
  output[64] = 27 + yParity;
  return Hex.from(output);
};

const assertUnlockedAccount = (keyring: SignerDeps["keyring"], address: string) => {
  if (!keyring.hasAccount("eip155", address)) {
    throw arxError({
      reason: ArxReasons.SessionLocked,
      message: `Address ${address} is not unlocked.`,
      data: { address },
    });
  }
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

const assertEip155Draft = (draft: TransactionDraft): draft is Eip155TransactionDraft => {
  return typeof draft.prepared === "object" && draft.prepared !== null && "callParams" in draft.prepared;
};

export const createEip155Signer = (deps: SignerDeps): Eip155Signer => {
  const signTransaction: Eip155Signer["signTransaction"] = async (context, draft) => {
    if (context.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `EIP-155 signer cannot handle namespace "${context.namespace}".`,
      });
    }

    if (!assertEip155Draft(draft)) {
      throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Signer expected an EIP-155 draft payload." });
    }

    const requestFrom = context.meta.from;
    if (!requestFrom) {
      throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Transaction from address is required." });
    }

    const activeFrom = context.from;
    if (activeFrom) {
      const normalizedRequest = requestFrom.toLowerCase();
      const normalizedActive = activeFrom.toLowerCase();
      if (normalizedRequest !== normalizedActive) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: "Transaction from address does not match active account.",
          data: { requestFrom, activeAccount: activeFrom },
        });
      }
    }

    const from = requestFrom;

    assertUnlockedAccount(deps.keyring, from);
    const chainId = deriveChainId(context, draft.prepared);
    const envelope = buildEnvelope(draft.prepared, chainId);

    const secret = await deps.keyring.exportPrivateKeyForSigning("eip155", from);
    try {
      if (envelope.type === "eip1559") {
        const payload = TransactionEnvelopeEip1559.getSignPayload(envelope.value);
        const signature = parseSignature(payload, secret);
        const signed = TransactionEnvelopeEip1559.from(envelope.value, {
          signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
        });
        const raw = TransactionEnvelopeEip1559.serialize(signed);
        const hash = TransactionEnvelopeEip1559.hash(signed);
        return { raw, hash };
      }

      const payload = TransactionEnvelopeLegacy.getSignPayload(envelope.value);
      const signature = parseSignature(payload, secret);
      const signed = TransactionEnvelopeLegacy.from(envelope.value, {
        signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
      });
      const raw = TransactionEnvelopeLegacy.serialize(signed);
      const hash = TransactionEnvelopeLegacy.hash(signed);
      return { raw, hash };
    } finally {
      zeroize(secret);
    }
  };

  const signPersonalMessage: Eip155Signer["signPersonalMessage"] = async ({ address, message }) => {
    assertUnlockedAccount(deps.keyring, address);

    const messageHex = toPersonalMessageHex(message);
    const payload = PersonalMessage.getSignPayload(messageHex);

    const secret = await deps.keyring.exportPrivateKeyForSigning("eip155", address);
    try {
      const signature = parseSignature(payload, secret);
      return composeSignatureHex(signature);
    } finally {
      zeroize(secret);
    }
  };

  const signTypedData: Eip155Signer["signTypedData"] = async ({ address, typedData }) => {
    assertUnlockedAccount(deps.keyring, address);

    const definition = parseTypedDataPayload(typedData);
    const encoded = TypedData.encode(definition);
    const digest = Hash.keccak256(encoded);

    const secret = await deps.keyring.exportPrivateKeyForSigning("eip155", address);
    try {
      const signature = parseSignature(digest, secret);
      return composeSignatureHex(signature);
    } finally {
      zeroize(secret);
    }
  };

  return {
    signTransaction,
    signPersonalMessage,
    signTypedData,
  };
};
