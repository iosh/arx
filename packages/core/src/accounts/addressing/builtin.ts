import { BUILTIN_NAMESPACE_MANIFESTS } from "../../namespaces/builtin.js";
import { type AccountCodec, AccountCodecRegistry } from "./codec.js";

type BuiltinAccountCodecRegistry = Pick<AccountCodecRegistry, "register" | "registerMany" | "get" | "require" | "list">;

const createBuiltinAccountCodecRegistry = (): BuiltinAccountCodecRegistry => {
  let registry: AccountCodecRegistry | null = null;

  const ensureRegistry = (): AccountCodecRegistry => {
    if (registry) {
      return registry;
    }

    const next = new AccountCodecRegistry();
    for (const manifest of BUILTIN_NAMESPACE_MANIFESTS) {
      next.register(manifest.core.accountCodec);
    }
    registry = next;
    return next;
  };

  return {
    register(codec: AccountCodec) {
      ensureRegistry().register(codec);
    },
    registerMany(codecs: readonly AccountCodec[]) {
      ensureRegistry().registerMany(codecs);
    },
    get(namespace: string) {
      return ensureRegistry().get(namespace);
    },
    require(namespace: string) {
      return ensureRegistry().require(namespace);
    },
    list() {
      return ensureRegistry().list();
    },
  };
};

export const BUILTIN_ACCOUNT_CODEC_REGISTRY = createBuiltinAccountCodecRegistry();

export const getAccountCodec = (namespace: string): AccountCodec => {
  return BUILTIN_ACCOUNT_CODEC_REGISTRY.require(namespace);
};
