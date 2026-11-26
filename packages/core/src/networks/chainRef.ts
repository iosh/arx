import { isSupportedNamespace, type Namespace } from "../namespaces/types.js";

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
  if (typeof value !== "string") throw new Error("A wallet chain reference must be a string.");

  const separatorIndex = value.indexOf(":");
  const namespace = value.slice(0, separatorIndex);
  const reference = value.slice(separatorIndex + 1);
  if (separatorIndex <= 0 || !isSupportedNamespace(namespace) || !CHAIN_REFERENCE_PATTERN.test(reference)) {
    throw new Error("Invalid wallet chain reference.");
  }

  return { namespace, reference };
};
