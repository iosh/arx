import type { Caip2ChainId } from "../controllers/index.js";
import { parseCaip2 } from "./caip.js";
import { eip155Descriptor } from "./eip155/descriptor.js";
import type { ChainDescriptor, FormatAddressParams, NormalizeAddressParams, NormalizedAddressResult } from "./types.js";
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

  getDescriptor(chainRef: Caip2ChainId): ChainDescriptor {
    const { namespace } = parseCaip2(chainRef);
    const descriptor = this.#descriptors.get(namespace);
    if (descriptor?.supportsChain(chainRef)) {
      return descriptor;
    }
    throw new Error(`No chain descriptor registered for "${chainRef}"`);
  }

  getAddressModule(chainRef: Caip2ChainId) {
    return this.getDescriptor(chainRef).address;
  }

  normalizeAddress(params: NormalizeAddressParams): NormalizedAddressResult {
    return this.getAddressModule(params.chainRef).normalize(params);
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
