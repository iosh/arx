import { providerErrors, rpcErrors } from "@metamask/rpc-errors";

type RpcErrorFactory = typeof rpcErrors;
type ProviderErrorFactory = typeof providerErrors;

export { keyringErrors } from "./keyring.js";
export { vaultErrors } from "./vault.js";

export type ChainErrorFactory = {
  rpc?: RpcErrorFactory;
  provider?: ProviderErrorFactory;
};

const DEFAULT_NAMESPACE = "eip155";

const factories = new Map<string, ChainErrorFactory>();

export const evmRpcErrors = rpcErrors;
export const evmProviderErrors = providerErrors;

const resolveFactory = (namespace?: string): ChainErrorFactory | undefined => {
  if (!namespace) {
    return factories.get(DEFAULT_NAMESPACE);
  }

  if (factories.has(namespace)) {
    return factories.get(namespace);
  }

  const [caipNamespace] = namespace.split(":");
  if (caipNamespace && factories.has(caipNamespace)) {
    return factories.get(caipNamespace);
  }

  return factories.get(DEFAULT_NAMESPACE);
};

export const registerChainErrorFactory = (namespace: string, factory: ChainErrorFactory): void => {
  factories.set(namespace, factory);
};

export const unregisterChainErrorFactory = (namespace: string): void => {
  factories.delete(namespace);
};

export const getRpcErrors = (namespace?: string): RpcErrorFactory => {
  return resolveFactory(namespace)?.rpc ?? rpcErrors;
};

export const getProviderErrors = (namespace?: string): ProviderErrorFactory => {
  return resolveFactory(namespace)?.provider ?? providerErrors;
};

registerChainErrorFactory(DEFAULT_NAMESPACE, {
  rpc: rpcErrors,
  provider: providerErrors,
});
