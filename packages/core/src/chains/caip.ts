import { chainErrors } from "./errors.js";
import type { ChainRef } from "./ids.js";

export const CAIP2_NAMESPACE_PATTERN = /^[a-z0-9]{3,8}$/;
export const CAIP2_REFERENCE_PATTERN = /^[a-zA-Z0-9-]{1,32}$/;
// Useful for schemas that only need a boolean check.
export const CAIP2_CHAIN_REF_PATTERN = /^[a-z0-9]{3,8}:[a-zA-Z0-9-]{1,32}$/;

export type ParsedChainRef = {
  namespace: string;
  reference: string;
};
export const parseChainRef = (value: ChainRef): ParsedChainRef => {
  if (typeof value !== "string") {
    throw chainErrors.invalidChainRef(value, { rule: "type" });
  }
  const first = value.indexOf(":");
  if (first <= 0 || first === value.length - 1) {
    throw chainErrors.invalidChainRef(value, { rule: "namespace:reference" });
  }
  // Reject additional ":" segments to avoid silently truncating CAIP-10-like strings.
  if (value.indexOf(":", first + 1) !== -1) {
    throw chainErrors.invalidChainRef(value, { rule: "single_colon" });
  }
  const namespace = value.slice(0, first);
  const reference = value.slice(first + 1);
  if (!CAIP2_NAMESPACE_PATTERN.test(namespace)) {
    throw chainErrors.invalidChainRef(value, { rule: "namespace", namespace });
  }
  if (!CAIP2_REFERENCE_PATTERN.test(reference)) {
    throw chainErrors.invalidChainRef(value, { rule: "reference", reference });
  }
  return { namespace, reference };
};

export const assertNamespace = (chainRef: ChainRef, expected: string): void => {
  const { namespace } = parseChainRef(chainRef);
  if (namespace !== expected) {
    throw chainErrors.namespaceMismatch({ chainRef, expected, actual: namespace });
  }
};

export const isChainRef = (value: unknown): value is ChainRef =>
  typeof value === "string" && CAIP2_CHAIN_REF_PATTERN.test(value);

export const assertChainRef = (value: unknown): asserts value is ChainRef => {
  if (!isChainRef(value)) {
    throw chainErrors.invalidChainRef(value, { rule: "pattern" });
  }
};

export const normalizeChainRef = (value: ChainRef): ChainRef => {
  const parsed = parseChainRef(value);
  return `${parsed.namespace}:${parsed.reference}`;
};
