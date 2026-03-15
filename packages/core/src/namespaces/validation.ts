import { parseChainRef } from "../chains/caip.js";
import type { NamespaceManifest } from "./types.js";

const buildMismatchMessage = (manifestNamespace: string, fieldPath: string, received: string) => {
  return `Namespace manifest "${manifestNamespace}" must align ${fieldPath} with manifest.namespace; received "${received}"`;
};

const buildInvalidChainRefMessage = (manifestNamespace: string, fieldPath: string, error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  return `Namespace manifest "${manifestNamespace}" has invalid ${fieldPath}: ${detail}`;
};

const assertNamespaceField = (manifest: NamespaceManifest, fieldPath: string, value: string): void => {
  if (value !== manifest.namespace) {
    throw new Error(buildMismatchMessage(manifest.namespace, fieldPath, value));
  }
};

const assertChainRefNamespace = (manifest: NamespaceManifest, fieldPath: string, chainRef: string): void => {
  let parsedNamespace: string;

  try {
    parsedNamespace = parseChainRef(chainRef).namespace;
  } catch (error) {
    throw new Error(buildInvalidChainRefMessage(manifest.namespace, fieldPath, error));
  }

  if (parsedNamespace !== manifest.namespace) {
    throw new Error(buildMismatchMessage(manifest.namespace, fieldPath, chainRef));
  }
};

export const assertValidNamespaceManifest = (manifest: NamespaceManifest): void => {
  assertNamespaceField(manifest, "core.namespace", manifest.core.namespace);
  assertNamespaceField(manifest, "core.rpc.namespace", manifest.core.rpc.namespace);
  assertNamespaceField(manifest, "core.rpc.adapter.namespace", manifest.core.rpc.adapter.namespace);
  assertNamespaceField(manifest, "core.chainAddressCodec.namespace", manifest.core.chainAddressCodec.namespace);
  assertNamespaceField(manifest, "core.accountCodec.namespace", manifest.core.accountCodec.namespace);
  assertNamespaceField(manifest, "core.keyring.namespace", manifest.core.keyring.namespace);
  assertNamespaceField(manifest, "core.keyring.codec.namespace", manifest.core.keyring.codec.namespace);
  assertChainRefNamespace(manifest, "core.keyring.defaultChainRef", manifest.core.keyring.defaultChainRef);

  for (const [index, chain] of manifest.core.chainSeeds?.entries() ?? []) {
    assertNamespaceField(manifest, `core.chainSeeds[${index}].namespace`, chain.namespace);
    assertChainRefNamespace(manifest, `core.chainSeeds[${index}].chainRef`, chain.chainRef);
  }
};

export const defineNamespaceManifest = <const TManifest extends NamespaceManifest>(manifest: TManifest): TManifest => {
  assertValidNamespaceManifest(manifest);
  return manifest;
};
