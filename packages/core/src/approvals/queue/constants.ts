export const ApprovalKinds = {
  RequestAccounts: "requestAccounts",
  RequestPermissions: "requestPermissions",
  SignMessage: "signMessage",
  SignTypedData: "signTypedData",
  SendTransaction: "sendTransaction",
  SwitchChain: "switchChain",
  AddChain: "addChain",
} as const;

export const ApprovalTypes = {
  RequestAccounts: "wallet_requestAccounts",
  RequestPermissions: "wallet_requestPermissions",
  SignMessage: "wallet_signMessage",
  SignTypedData: "wallet_signTypedData",
  SendTransaction: "wallet_sendTransaction",
  SwitchChain: "wallet_switchEthereumChain",
  AddChain: "wallet_addEthereumChain",
} as const;

export type ApprovalKind = (typeof ApprovalKinds)[keyof typeof ApprovalKinds];
export type ApprovalType = (typeof ApprovalTypes)[keyof typeof ApprovalTypes];

export const ApprovalKindToType: Record<ApprovalKind, ApprovalType> = {
  [ApprovalKinds.RequestAccounts]: ApprovalTypes.RequestAccounts,
  [ApprovalKinds.RequestPermissions]: ApprovalTypes.RequestPermissions,
  [ApprovalKinds.SignMessage]: ApprovalTypes.SignMessage,
  [ApprovalKinds.SignTypedData]: ApprovalTypes.SignTypedData,
  [ApprovalKinds.SendTransaction]: ApprovalTypes.SendTransaction,
  [ApprovalKinds.SwitchChain]: ApprovalTypes.SwitchChain,
  [ApprovalKinds.AddChain]: ApprovalTypes.AddChain,
};

export const ApprovalTypeToKind: Record<ApprovalType, ApprovalKind> = {
  [ApprovalTypes.RequestAccounts]: ApprovalKinds.RequestAccounts,
  [ApprovalTypes.RequestPermissions]: ApprovalKinds.RequestPermissions,
  [ApprovalTypes.SignMessage]: ApprovalKinds.SignMessage,
  [ApprovalTypes.SignTypedData]: ApprovalKinds.SignTypedData,
  [ApprovalTypes.SendTransaction]: ApprovalKinds.SendTransaction,
  [ApprovalTypes.SwitchChain]: ApprovalKinds.SwitchChain,
  [ApprovalTypes.AddChain]: ApprovalKinds.AddChain,
};

export const getApprovalKind = (type: ApprovalType): ApprovalKind => ApprovalTypeToKind[type];

export const getApprovalType = (kind: ApprovalKind): ApprovalType => ApprovalKindToType[kind];
