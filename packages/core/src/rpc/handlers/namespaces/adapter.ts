import type { MethodDefinition, Namespace } from "../types.js";
/**
 * Passthrough configuration for namespace adapters.
 *
 * Allows forwarding selected RPC methods directly to the RPC node without
 * wallet-side intervention (no state changes or signing).
 */
export type NamespaceAdapterPassthrough = {
  /** RPC methods permitted to bypass wallet handlers */
  allowedMethods: readonly string[];
  /** Subset of allowedMethods usable while the wallet is locked */
  allowWhenLocked?: readonly string[];
};

export type NamespaceAdapter = {
  namespace: Namespace;
  methodPrefixes?: string[];
  definitions: Record<string, MethodDefinition>;
  passthrough?: NamespaceAdapterPassthrough;
};
