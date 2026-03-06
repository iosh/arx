import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createEip155AddressModule } from "../../chains/eip155/address.js";
import type { ChainRef } from "../../chains/ids.js";
import { type AccountId, AccountIdSchema } from "../../storage/records.js";

export type CanonicalAddress = {
  namespace: string;
  bytes: Uint8Array;
};

export type AccountCodec = {
  namespace: string;

  toCanonicalAddress(params: { chainRef: ChainRef; value: string }): CanonicalAddress;
  toCanonicalString(params: { chainRef: ChainRef; canonical: CanonicalAddress }): string;
  toDisplayAddress(params: { chainRef: ChainRef; canonical: CanonicalAddress }): string;

  toAccountId(canonical: CanonicalAddress): AccountId;
  fromAccountId(accountId: AccountId): CanonicalAddress;
};

const parseAccountIdParts = (accountId: AccountId): { namespace: string; payloadHex: string } => {
  const parsed = AccountIdSchema.parse(accountId);
  const separatorIndex = parsed.indexOf(":");
  if (separatorIndex < 0) {
    throw new Error(`Invalid accountId format: ${parsed}`);
  }

  return {
    namespace: parsed.slice(0, separatorIndex),
    payloadHex: parsed.slice(separatorIndex + 1),
  };
};

const requireAccountIdNamespace = (accountId: AccountId, namespace: string): string => {
  const parsed = parseAccountIdParts(accountId);
  if (parsed.namespace !== namespace) {
    throw new Error(`AccountId namespace mismatch: expected "${namespace}", got "${parsed.namespace}"`);
  }
  return parsed.payloadHex;
};

const eip155Module = createEip155AddressModule();

export const eip155Codec: AccountCodec = {
  namespace: "eip155",

  toCanonicalAddress({ chainRef, value }) {
    const { canonical } = eip155Module.canonicalize({ chainRef, value });
    return {
      namespace: "eip155",
      bytes: hexToBytes(canonical.slice(2)),
    };
  },

  toCanonicalString({ canonical }) {
    if (canonical.namespace !== "eip155") {
      throw new Error(`Unsupported namespace for eip155Codec: ${canonical.namespace}`);
    }
    return `0x${bytesToHex(canonical.bytes)}`.toLowerCase();
  },

  toDisplayAddress({ chainRef, canonical }) {
    const hex = `0x${bytesToHex(canonical.bytes)}`;
    return eip155Module.format({ chainRef, canonical: hex });
  },

  toAccountId(canonical) {
    if (canonical.namespace !== "eip155") {
      throw new Error(`Unsupported namespace for eip155Codec: ${canonical.namespace}`);
    }
    return AccountIdSchema.parse(`eip155:${bytesToHex(canonical.bytes)}`);
  },

  fromAccountId(accountId) {
    const payloadHex = requireAccountIdNamespace(accountId, "eip155");
    return { namespace: "eip155", bytes: hexToBytes(payloadHex) };
  },
};

export const ACCOUNT_CODECS = {
  eip155: eip155Codec,
} as const satisfies Record<string, AccountCodec>;

export const getAccountCodec = (namespace: string): AccountCodec => {
  const codec = ACCOUNT_CODECS[namespace as keyof typeof ACCOUNT_CODECS];
  if (codec) return codec;
  throw new Error(`No account codec registered for namespace "${namespace}"`);
};
