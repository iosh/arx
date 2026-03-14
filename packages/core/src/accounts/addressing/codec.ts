import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { parseChainRef } from "../../chains/caip.js";
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
  toCanonicalString(params: { canonical: CanonicalAddress }): string;
  toDisplayAddress(params: { chainRef: ChainRef; canonical: CanonicalAddress }): string;

  toAccountId(canonical: CanonicalAddress): AccountId;
  fromAccountId(accountId: AccountId): CanonicalAddress;
};

export class AccountCodecRegistry {
  #codecs = new Map<string, AccountCodec>();

  constructor(codecs: readonly AccountCodec[] = []) {
    this.registerMany(codecs);
  }

  register(codec: AccountCodec): void {
    const existing = this.#codecs.get(codec.namespace);
    if (existing && existing !== codec) {
      throw new Error(`Account codec for namespace "${codec.namespace}" is already registered`);
    }
    if (!existing) {
      this.#codecs.set(codec.namespace, codec);
    }
  }

  registerMany(codecs: readonly AccountCodec[]): void {
    for (const codec of codecs) {
      this.register(codec);
    }
  }

  get(namespace: string): AccountCodec | undefined {
    return this.#codecs.get(namespace);
  }

  require(namespace: string): AccountCodec {
    const codec = this.get(namespace);
    if (codec) return codec;
    throw new Error(`No account codec registered for namespace "${namespace}"`);
  }

  toAccountIdFromAddress(params: { chainRef: ChainRef; address: string }): AccountId {
    const { namespace } = parseChainRef(params.chainRef);
    const codec = this.require(namespace);
    const canonical = codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
    return codec.toAccountId(canonical);
  }

  toCanonicalAddressFromAccountId(params: { accountId: AccountId }): string {
    const namespace = parseAccountIdParts(params.accountId).namespace;
    const codec = this.require(namespace);
    const canonical = codec.fromAccountId(params.accountId);
    return codec.toCanonicalString({ canonical });
  }

  toDisplayAddressFromAccountId(params: { chainRef: ChainRef; accountId: AccountId }): string {
    const { namespace } = parseChainRef(params.chainRef);
    const codec = this.require(namespace);
    const canonical = codec.fromAccountId(params.accountId);
    return codec.toDisplayAddress({ chainRef: params.chainRef, canonical });
  }

  list(): AccountCodec[] {
    return [...this.#codecs.values()];
  }
}

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

export const createAccountCodecRegistry = (codecs: readonly AccountCodec[] = []): AccountCodecRegistry =>
  new AccountCodecRegistry(codecs);
