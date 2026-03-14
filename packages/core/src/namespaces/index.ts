export {
  assembleRuntimeNamespaces,
  collectChainSeedsFromManifests,
  createAccountCodecRegistryFromManifests,
  createChainAddressCodecRegistryFromManifests,
  createKeyringNamespacesFromManifests,
  registerRpcClientFactoriesFromManifests,
  registerRpcModulesFromManifests,
} from "./assembly.js";
export { BUILTIN_NAMESPACE_MANIFESTS, createBuiltinKeyringNamespaces } from "./builtin.js";
export { eip155NamespaceManifest } from "./eip155/manifest.js";
export type {
  NamespaceApprovalBindings,
  NamespaceCoreManifest,
  NamespaceManifest,
  NamespaceRuntimeBindingsRegistry,
  NamespaceRuntimeManifest,
  NamespaceSignerRegistry,
  NamespaceUiBindings,
} from "./types.js";
