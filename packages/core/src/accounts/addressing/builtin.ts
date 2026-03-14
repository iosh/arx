import { BUILTIN_NAMESPACE_MANIFESTS } from "../../namespaces/builtin.js";
import type { AccountCodec } from "./codec.js";
import { createAccountCodecRegistry } from "./codec.js";

export const BUILTIN_ACCOUNT_CODEC_REGISTRY = createAccountCodecRegistry(
  BUILTIN_NAMESPACE_MANIFESTS.map((manifest) => manifest.core.accountCodec),
);

export const getAccountCodec = (namespace: string): AccountCodec => {
  return BUILTIN_ACCOUNT_CODEC_REGISTRY.require(namespace);
};
