import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import { createKeyringNamespacesFromManifests } from "./assembly.js";
import { eip155NamespaceManifest } from "./eip155/manifest.js";
import type { NamespaceManifest } from "./types.js";

// Compatibility helper for callers without a platform composition root.
// Real platforms should pass explicit manifests instead of relying on this builtin list.
export const BUILTIN_NAMESPACE_MANIFESTS = [eip155NamespaceManifest] as const satisfies readonly NamespaceManifest[];

export const createBuiltinKeyringNamespaces = (): NamespaceConfig[] => {
  return createKeyringNamespacesFromManifests(BUILTIN_NAMESPACE_MANIFESTS);
};
