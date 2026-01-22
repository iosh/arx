import type { ChainRef } from "./ids.js";

const CAIP2_NAMESPACE_PATTERN = /^[a-z0-9]{3,8}$/;
const CAIP2_REFERENCE_PATTERN = /^[a-zA-Z0-9-]{1,32}$/;

export type ParsedChainRef = {
  namespace: string;
  reference: string;
};
export const parseChainRef = (value: ChainRef): ParsedChainRef => {
  if (typeof value !== "string") {
    throw new Error(`Invalid CAIP-2 identifier: ${String(value)}`);
  }
  const [namespace, reference] = value.split(":");
  if (!namespace || !reference) {
    throw new Error(`CAIP-2 identifier must be "namespace:reference": ${value}`);
  }
  if (!CAIP2_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`Invalid CAIP-2 namespace: ${namespace}`);
  }
  if (!CAIP2_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`Invalid CAIP-2 reference: ${reference}`);
  }
  return { namespace, reference };
};

export const assertNamespace = (chainRef: ChainRef, expected: string): void => {
  const { namespace } = parseChainRef(chainRef);
  if (namespace !== expected) {
    throw new Error(`Chain ${chainRef} does not belong to namespace "${expected}"`);
  }
};
