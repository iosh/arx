import { NAMESPACE_PATTERN, type Namespace } from "../namespaces/types.js";
import { InvalidChainRefError } from "./errors.js";

const CHAIN_REFERENCE_PATTERN = /^[-_a-zA-Z0-9]{1,32}$/;

export type ChainRef = string;

export type ParsedChainRef = Readonly<{
  namespace: Namespace;
  reference: string;
}>;

export const parseChainRef = (value: unknown): ParsedChainRef => {
  if (typeof value !== "string") {
    throw new InvalidChainRefError("type");
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new InvalidChainRefError("namespace:reference");
  }
  if (value.indexOf(":", separatorIndex + 1) !== -1) {
    throw new InvalidChainRefError("single_colon");
  }

  const namespace = value.slice(0, separatorIndex);
  const reference = value.slice(separatorIndex + 1);
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new InvalidChainRefError("namespace");
  }
  if (!CHAIN_REFERENCE_PATTERN.test(reference)) {
    throw new InvalidChainRefError("reference");
  }

  return { namespace, reference };
};
