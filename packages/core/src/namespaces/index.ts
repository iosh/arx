export { builtinNamespaces } from "./builtin.js";
export type { NamespaceDefinition } from "./definition.js";
export { chainIdFromChainRef, chainRefFromChainId, validateEip155ChainReference } from "./eip155/chainId.js";
export { EIP155_NAMESPACE } from "./eip155/constants.js";
export {
  Eip155InvalidChainIdError,
  Eip155InvalidPrivateKeyError,
  Eip155SigningAccountMismatchError,
} from "./eip155/errors.js";
export { eip155Namespace } from "./eip155/namespace.js";
export type {
  Eip155PersonalMessage,
  Eip155SignRequest,
  Eip155TypedData,
  Eip155TypedDataField,
  Eip155TypedDataValue,
} from "./eip155/signingRequest.js";
export { NAMESPACE_PATTERN, type Namespace } from "./types.js";
