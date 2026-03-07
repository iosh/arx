import { parseChainRef } from "./caip.js";
import { eip155AddressCodec } from "./eip155/addressCodec.js";
import { chainErrors } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  ChainAddressCodec,
  FormatAddressParams,
} from "./types.js";

export class ChainAddressCodecRegistry {
  #codecs = new Map<string, ChainAddressCodec>();

  constructor(codecs: ChainAddressCodec[] = []) {
    for (const codec of codecs) {
      this.registerCodec(codec);
    }
  }

  registerCodec(codec: ChainAddressCodec): void {
    if (this.#codecs.has(codec.namespace)) {
      throw new Error(`Chain address codec already registered for namespace "${codec.namespace}"`);
    }
    this.#codecs.set(codec.namespace, codec);
  }

  unregisterCodec(namespace: string): void {
    this.#codecs.delete(namespace);
  }

  getCodec(chainRef: ChainRef): ChainAddressCodec {
    const { namespace } = parseChainRef(chainRef);
    const codec = this.#codecs.get(namespace);
    if (codec) return codec;
    throw chainErrors.namespaceNotSupported({ chainRef, namespace });
  }

  getAddressModule(chainRef: ChainRef) {
    return this.getCodec(chainRef).address;
  }

  toCanonicalAddress(params: CanonicalizeAddressParams): CanonicalizedAddressResult {
    return this.getAddressModule(params.chainRef).canonicalize(params);
  }

  formatAddress(params: FormatAddressParams): string {
    return this.getAddressModule(params.chainRef).format(params);
  }

  validateAddress(params: FormatAddressParams): void {
    this.getAddressModule(params.chainRef).validate?.(params);
  }
}

export const createDefaultChainAddressCodecRegistry = (): ChainAddressCodecRegistry => {
  return new ChainAddressCodecRegistry([eip155AddressCodec]);
};
