export const ApprovalTypes = {
  RequestAccounts: "wallet_requestAccounts",
  RequestPermissions: "wallet_requestPermissions",
  SignMessage: "wallet_signMessage",
  SignTypedData: "wallet_signTypedData",
  SendTransaction: "wallet_sendTransaction",
  SwitchChain: "wallet_switchEthereumChain",
  AddChain: "wallet_addEthereumChain",
} as const;
