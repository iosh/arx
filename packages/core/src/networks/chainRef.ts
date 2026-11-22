import { isSupportedNamespace, type Namespace } from "../namespaces/types.js";
import { InvalidChainRefError } from "./errors.js";

const CHAIN_REFERENCE_PATTERN = /^[-_a-zA-Z0-9]{1,32}$/;

/** CAIP-2 chain identity within the wallet's supported namespaces. */
export type ChainRef = `${Namespace}:${string}`;

export type ParsedChainRef = Readonly<{
  namespace: Namespace;
  reference: string;
}>;

/** Splits an already validated chain reference without decoding it again. */
export const splitChainRef = (chainRef: ChainRef): ParsedChainRef => {
  const separatorIndex = chainRef.indexOf(":");
  return {
    namespace: chainRef.slice(0, separatorIndex) as Namespace,
    reference: chainRef.slice(separatorIndex + 1),
  };
};

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
  if (!isSupportedNamespace(namespace)) {
    throw new InvalidChainRefError("namespace");
  }
  if (!CHAIN_REFERENCE_PATTERN.test(reference)) {
    throw new InvalidChainRefError("reference");
  }

  return { namespace, reference };
};
