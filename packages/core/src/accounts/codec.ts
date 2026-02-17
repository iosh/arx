import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createEip155AddressModule } from "../chains/eip155/address.js";
import type { ChainRef } from "../chains/ids.js";
import { type AccountId, AccountIdSchema } from "../db/records.js";

export type CanonicalAddress = {
  namespace: string;
  bytes: Uint8Array;
  /**
   * Optional discriminator for namespaces where the same payload bytes can map to
   * multiple address "kinds" (eg. user vs contract).
   */
  kind?: string;
};

export type AccountCodec = {
  namespace: string;

  toCanonicalAddress(params: { chainRef: ChainRef; value: string }): CanonicalAddress;
  // Canonical string representation (stable for storage/dedupe).
  toCanonicalString(params: { chainRef: ChainRef; canonical: CanonicalAddress }): string;
  toDisplayAddress(params: { chainRef: ChainRef; canonical: CanonicalAddress }): string;

  toAccountId(canonical: CanonicalAddress): AccountId;
  fromAccountId(accountId: AccountId): CanonicalAddress;
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
    const parsed = AccountIdSchema.parse(accountId);
    const payloadHex = parsed.slice("eip155:".length);
    return { namespace: "eip155", bytes: hexToBytes(payloadHex) };
  },
};

export const getAccountCodec = (namespace: string): AccountCodec => {
  if (namespace === "eip155") return eip155Codec;
  throw new Error(`No account codec registered for namespace "${namespace}"`);
};
