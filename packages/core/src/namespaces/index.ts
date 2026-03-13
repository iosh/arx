export {
  assembleRuntimeNamespaces,
  collectChainSeedsFromManifests,
  createChainAddressCodecRegistryFromManifests,
  createKeyringNamespacesFromManifests,
  registerRpcClientFactoriesFromManifests,
  registerRpcModulesFromManifests,
} from "./assembly.js";
export { BUILTIN_NAMESPACE_MANIFESTS, createBuiltinKeyringNamespaces } from "./builtin.js";
export { eip155NamespaceManifest } from "./eip155/manifest.js";
export type { NamespaceCoreManifest, NamespaceManifest, NamespaceRuntimeManifest } from "./types.js";
