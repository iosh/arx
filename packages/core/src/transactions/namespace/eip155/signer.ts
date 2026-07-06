import * as Hash from "ox/Hash";
import type { Hex as HexType } from "ox/Hex";
import * as Hex from "ox/Hex";
import * as PersonalMessage from "ox/PersonalMessage";
import * as TransactionEnvelopeEip1559 from "ox/TransactionEnvelopeEip1559";
import * as TransactionEnvelopeLegacy from "ox/TransactionEnvelopeLegacy";
import * as TypedData from "ox/TypedData";
import { accountIdFromChainAddress } from "../../../accounts/addressing/accountId.js";
import { eip155AccountAddressing } from "../../../accounts/addressing/addressing.js";
import { RpcInvalidParamsError, RpcInvalidRequestError } from "../../../rpc/errors.js";
import { EIP155_NAMESPACE } from "../../../rpc/handlers/namespaces/eip155/constants.js";
import type { AccountSigningService } from "../../../services/runtime/accountSigning.js";
import { Eip155SigningAbortedError } from "./errors.js";
import type { Eip155SignerContract } from "./types.js";
import type { Eip155UnsignedTransaction } from "./unsignedTransaction.js";

const textEncoder = new TextEncoder();
const EIP155_ACCOUNT_ADDRESSING = { [EIP155_NAMESPACE]: eip155AccountAddressing };

type SignerDeps = {
  accountSigning: Pick<AccountSigningService, "assertAccountUnlocked" | "signDigestByAccountId">;
};

export type Eip155Signer = {
  signTransaction: Eip155SignerContract["signTransaction"];
  signPersonalMessage: (params: { accountId: string; message: HexType | string }) => Promise<HexType>;
  signTypedData: (params: { accountId: string; typedData: string }) => Promise<HexType>;
};

type ParsedSignature = {
  r: bigint;
  s: bigint;
  yParity: number;
  bytes: Uint8Array;
};

const isHexValue = (value: unknown): value is HexType => typeof value === "string" && value.startsWith("0x");

const throwIfSignAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }

  throw new Eip155SigningAbortedError();
};

const readHexQuantity = (value: HexType, label: string): bigint => {
  try {
    return Hex.toBigInt(value);
  } catch {
    throw new RpcInvalidRequestError({
      message: `Transaction ${label} is not a valid hex quantity.`,
    });
  }
};

/** Reads the numeric chainId from the approved transaction. */
const readChainId = (transaction: Eip155UnsignedTransaction): number => {
  const numeric = Number(readHexQuantity(transaction.chainId, "chainId"));
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new RpcInvalidRequestError({
      message: "Transaction chainId must be a positive 53-bit integer.",
    });
  }
  return numeric;
};

const buildEnvelope = (
  transaction: Eip155UnsignedTransaction,
  chainId: number,
):
  | { type: "eip1559"; value: TransactionEnvelopeEip1559.TransactionEnvelopeEip1559 }
  | { type: "legacy"; value: TransactionEnvelopeLegacy.TransactionEnvelopeLegacy } => {
  const base = {
    chainId,
    nonce: readHexQuantity(transaction.nonce, "nonce"),
    to: transaction.to ?? undefined,
    data: transaction.data,
    value: readHexQuantity(transaction.value, "value"),
    gas: readHexQuantity(transaction.gas, "gas"),
  };

  if (transaction.type === "eip1559") {
    return {
      type: "eip1559",
      value: TransactionEnvelopeEip1559.from({
        ...base,
        type: "eip1559",
        maxFeePerGas: readHexQuantity(transaction.maxFeePerGas, "maxFeePerGas"),
        maxPriorityFeePerGas: readHexQuantity(transaction.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
      }),
    };
  }

  return {
    type: "legacy",
    value: TransactionEnvelopeLegacy.from({
      ...base,
      type: "legacy",
      gasPrice: readHexQuantity(transaction.gasPrice, "gasPrice"),
    }),
  };
};

const composeSignatureHex = ({ bytes, yParity }: ParsedSignature): HexType => {
  const output = new Uint8Array(65);
  output.set(bytes.subarray(0, 64), 0);
  output[64] = 27 + yParity;
  return Hex.from(output);
};

const toEip155AccountId = (params: { chainRef: string; address: string }) => {
  return accountIdFromChainAddress({
    chainRef: params.chainRef,
    address: params.address,
    accountAddressing: EIP155_ACCOUNT_ADDRESSING,
  });
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
    throw new RpcInvalidParamsError({
      message: "Typed data payload must be valid JSON.",
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new RpcInvalidParamsError({
      message: "Typed data payload must be a JSON object.",
    });
  }

  try {
    TypedData.assert(parsed as TypedData.Definition<Record<string, unknown>, string>);
  } catch (error) {
    throw new RpcInvalidParamsError({
      message: "Typed data payload failed validation.",
      cause: error,
    });
  }

  return parsed as TypedData.Definition<Record<string, unknown>, string>;
};

export const createEip155Signer = ({ accountSigning }: SignerDeps): Eip155Signer => {
  const signTransaction: Eip155Signer["signTransaction"] = async (context, transaction, options) => {
    throwIfSignAborted(options?.signal);

    if (transaction.from.toLowerCase() !== context.from.toLowerCase()) {
      throw new RpcInvalidRequestError({
        message: "Transaction from address does not match approved account.",
      });
    }

    const fromAccountId = toEip155AccountId({ chainRef: context.chainRef, address: context.from });
    await accountSigning.assertAccountUnlocked(fromAccountId);
    throwIfSignAborted(options?.signal);
    const chainId = readChainId(transaction);
    const envelope = buildEnvelope(transaction, chainId);

    if (envelope.type === "eip1559") {
      const txSignPayload = TransactionEnvelopeEip1559.getSignPayload(envelope.value);
      const signature = await accountSigning.signDigestByAccountId({
        accountId: fromAccountId,
        digest: Hex.toBytes(txSignPayload),
      });
      const signed = TransactionEnvelopeEip1559.from(envelope.value, {
        signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
      });
      const raw = TransactionEnvelopeEip1559.serialize(signed);
      return { raw };
    }

    const txSignPayload = TransactionEnvelopeLegacy.getSignPayload(envelope.value);
    const signature = await accountSigning.signDigestByAccountId({
      accountId: fromAccountId,
      digest: Hex.toBytes(txSignPayload),
    });
    const signed = TransactionEnvelopeLegacy.from(envelope.value, {
      signature: { r: signature.r, s: signature.s, yParity: signature.yParity },
    });
    const raw = TransactionEnvelopeLegacy.serialize(signed);
    return { raw };
  };

  const signPersonalMessage: Eip155Signer["signPersonalMessage"] = async ({ accountId, message }) => {
    await accountSigning.assertAccountUnlocked(accountId);

    const messageHex = toPersonalMessageHex(message);
    const payload = PersonalMessage.getSignPayload(messageHex);

    const signature = await accountSigning.signDigestByAccountId({
      accountId,
      digest: Hex.toBytes(payload),
    });
    return composeSignatureHex(signature);
  };

  const signTypedData: Eip155Signer["signTypedData"] = async ({ accountId, typedData }) => {
    await accountSigning.assertAccountUnlocked(accountId);

    const definition = parseTypedDataPayload(typedData);
    const encoded = TypedData.encode(definition);
    const digest = Hash.keccak256(encoded);

    const signature = await accountSigning.signDigestByAccountId({
      accountId,
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
