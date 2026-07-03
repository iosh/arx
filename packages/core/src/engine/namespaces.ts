import type { NamespaceManifest } from "../namespaces/index.js";
import { DuplicateWalletNamespaceManifestError, WalletNamespaceManifestNotFoundError } from "./errors.js";
import type { WalletNamespaces } from "./types.js";

export const createWalletNamespaces = (params: { manifests: readonly NamespaceManifest[] }): WalletNamespaces => {
  const { manifests } = params;

  const manifestByNamespace = new Map<string, NamespaceManifest>();
  for (const manifest of manifests) {
    if (manifestByNamespace.has(manifest.namespace)) {
      throw new DuplicateWalletNamespaceManifestError({ namespace: manifest.namespace });
    }
    manifestByNamespace.set(manifest.namespace, manifest);
  }

  const manifestsSnapshot = [...manifestByNamespace.values()];

  const findManifest = (namespace: string): NamespaceManifest | undefined => manifestByNamespace.get(namespace);

  const requireManifest = (namespace: string): NamespaceManifest => {
    const manifest = manifestByNamespace.get(namespace);
    if (manifest) return manifest;
    throw new WalletNamespaceManifestNotFoundError({ namespace });
  };

  return {
    findManifest,
    requireManifest,
    listManifests: () => [...manifestsSnapshot],
    listNamespaces: () => manifestsSnapshot.map((manifest) => manifest.namespace),
  };
};
