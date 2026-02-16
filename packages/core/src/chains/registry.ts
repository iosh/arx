import { parseChainRef } from "./caip.js";
import { eip155Descriptor } from "./eip155/descriptor.js";
import type { ChainRef } from "./ids.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  ChainDescriptor,
  FormatAddressParams,
} from "./types.js";
export class ChainModuleRegistry {
  #descriptors = new Map<string, ChainDescriptor>();

  constructor(descriptors: ChainDescriptor[] = []) {
    for (const descriptor of descriptors) {
      this.registerDescriptor(descriptor);
    }
  }

  registerDescriptor(descriptor: ChainDescriptor): void {
    this.#descriptors.set(descriptor.namespace, descriptor);
  }

  unregisterDescriptor(namespace: string): void {
    this.#descriptors.delete(namespace);
  }

  getDescriptor(chainRef: ChainRef): ChainDescriptor {
    const { namespace } = parseChainRef(chainRef);
    const descriptor = this.#descriptors.get(namespace);
    if (descriptor) return descriptor;
    throw new Error(`No chain descriptor registered for "${chainRef}"`);
  }

  getAddressModule(chainRef: ChainRef) {
    return this.getDescriptor(chainRef).address;
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

export const createDefaultChainModuleRegistry = (): ChainModuleRegistry => {
  return new ChainModuleRegistry([eip155Descriptor]);
};
