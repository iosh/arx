export {
  chainIdFromChainRef,
  chainRefFromChainId,
  type Eip155ChainRef,
  MAX_EIP155_CHAIN_ID,
} from "./eip155/chainId.js";
export { EIP155_NAMESPACE } from "./eip155/constants.js";
export { Eip155InvalidChainIdError, Eip155SigningAccountMismatchError } from "./eip155/errors.js";
export type { Eip155ChainIdOptions, Eip155Rpc } from "./eip155/rpc.js";
export type {
  Eip155PersonalMessage,
  Eip155SignRequest,
  Eip155TypedData,
  Eip155TypedDataField,
  Eip155TypedDataValue,
} from "./eip155/signingRequest.js";
export { isSupportedNamespace, type Namespace, SUPPORTED_NAMESPACES } from "./types.js";
