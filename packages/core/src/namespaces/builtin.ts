import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import { eip155NamespaceManifest } from "./eip155/manifest.js";
import type { NamespaceManifest } from "./types.js";

export const BUILTIN_NAMESPACE_MANIFESTS = [eip155NamespaceManifest] as const satisfies readonly NamespaceManifest[];

export const createBuiltinKeyringNamespaces = (): NamespaceConfig[] => {
  return BUILTIN_NAMESPACE_MANIFESTS.map((manifest) => ({
    ...manifest.core.keyring,
    factories: { ...manifest.core.keyring.factories },
  }));
};
