import { parseChainRef } from "./caip.js";
import { eip155Descriptor } from "./eip155/descriptor.js";
import { chainErrors } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  ChainDescriptor,
  FormatAddressParams,
} from "./types.js";
export class ChainDescriptorRegistry {
  #descriptors = new Map<string, ChainDescriptor>();

  constructor(descriptors: ChainDescriptor[] = []) {
    for (const descriptor of descriptors) {
      this.registerDescriptor(descriptor);
    }
  }

  registerDescriptor(descriptor: ChainDescriptor): void {
    if (this.#descriptors.has(descriptor.namespace)) {
      throw new Error(`Chain descriptor already registered for namespace "${descriptor.namespace}"`);
    }
    this.#descriptors.set(descriptor.namespace, descriptor);
  }

  unregisterDescriptor(namespace: string): void {
    this.#descriptors.delete(namespace);
  }

  getDescriptor(chainRef: ChainRef): ChainDescriptor {
    const { namespace } = parseChainRef(chainRef);
    const descriptor = this.#descriptors.get(namespace);
    if (descriptor) return descriptor;
    throw chainErrors.namespaceNotSupported({ chainRef, namespace });
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

export const createDefaultChainDescriptorRegistry = (): ChainDescriptorRegistry => {
  return new ChainDescriptorRegistry([eip155Descriptor]);
};
