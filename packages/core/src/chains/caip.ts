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
  const first = value.indexOf(":");
  if (first <= 0 || first === value.length - 1) {
    throw new Error(`CAIP-2 identifier must be "namespace:reference": ${value}`);
  }
  // Reject additional ":" segments to avoid silently truncating CAIP-10-like strings.
  if (value.indexOf(":", first + 1) !== -1) {
    throw new Error(`CAIP-2 identifier must contain exactly one ":": ${value}`);
  }
  const namespace = value.slice(0, first);
  const reference = value.slice(first + 1);
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
