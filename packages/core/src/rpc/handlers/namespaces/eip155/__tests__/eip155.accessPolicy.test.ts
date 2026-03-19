import { describe, expect, it } from "vitest";
import { type RpcRequestKind, RpcRequestKinds } from "../../../../requestKind.js";
import {
  type ApprovalRequirement,
  ApprovalRequirements,
  type AuthorizedScopeCheck,
  AuthorizedScopeChecks,
  type ConnectionRequirement,
  ConnectionRequirements,
} from "../../../types.js";
import { EIP155_DEFINITIONS, type Eip155Method } from "../definitions.js";

type MethodAccessPolicySnapshot = {
  requestKind: RpcRequestKind | null;
  connectionRequirement: ConnectionRequirement;
  approvalRequirement: ApprovalRequirement;
  authorizedScopeCheck: AuthorizedScopeCheck;
  lockedType: string | null;
};

const EXPECTED_METHOD_ACCESS_POLICY: Record<Eip155Method, MethodAccessPolicySnapshot> = {
  eth_accounts: {
    requestKind: RpcRequestKinds.AccountAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "response",
  },
  eth_chainId: {
    requestKind: null,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: null,
  },
  eth_requestAccounts: {
    requestKind: RpcRequestKinds.AccountAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  eth_sendTransaction: {
    requestKind: RpcRequestKinds.TransactionSubmission,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  eth_signTypedData_v4: {
    requestKind: RpcRequestKinds.MessageSigning,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  personal_sign: {
    requestKind: RpcRequestKinds.MessageSigning,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  wallet_addEthereumChain: {
    requestKind: RpcRequestKinds.ChainManagement,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  wallet_getPermissions: {
    requestKind: RpcRequestKinds.AccountAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "allow",
  },
  wallet_requestPermissions: {
    requestKind: RpcRequestKinds.AccountAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  wallet_switchEthereumChain: {
    requestKind: RpcRequestKinds.ChainManagement,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
};

describe("EIP155_DEFINITIONS access policy facts", () => {
  it.each(
    Object.entries(EXPECTED_METHOD_ACCESS_POLICY) as [Eip155Method, MethodAccessPolicySnapshot][],
  )("declares %s static access policy facts", (method, expected) => {
    const definition = EIP155_DEFINITIONS[method];

    expect({
      requestKind: definition.requestKind ?? null,
      connectionRequirement: definition.connectionRequirement,
      approvalRequirement: definition.approvalRequirement,
      authorizedScopeCheck: definition.authorizedScopeCheck,
      lockedType: definition.locked?.type ?? null,
    }).toEqual(expected);
  });
});
