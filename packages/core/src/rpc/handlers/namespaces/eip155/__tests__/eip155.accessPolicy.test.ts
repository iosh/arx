import { describe, expect, it } from "vitest";
import { type RpcRequestClassification, RpcRequestClassifications } from "../../../../requestClassification.js";
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
  requestClassification: RpcRequestClassification | null;
  connectionRequirement: ConnectionRequirement;
  approvalRequirement: ApprovalRequirement;
  authorizedScopeCheck: AuthorizedScopeCheck;
  lockedType: string | null;
};

const EXPECTED_METHOD_ACCESS_POLICY: Record<Eip155Method, MethodAccessPolicySnapshot> = {
  eth_accounts: {
    requestClassification: RpcRequestClassifications.AccountsAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "response",
  },
  eth_chainId: {
    requestClassification: null,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: null,
  },
  eth_requestAccounts: {
    requestClassification: RpcRequestClassifications.AccountsAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  eth_sendTransaction: {
    requestClassification: RpcRequestClassifications.TransactionSubmission,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  eth_signTypedData_v4: {
    requestClassification: RpcRequestClassifications.MessageSigning,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  personal_sign: {
    requestClassification: RpcRequestClassifications.MessageSigning,
    connectionRequirement: ConnectionRequirements.Required,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.NamespaceSpecific,
    lockedType: "queue",
  },
  wallet_addEthereumChain: {
    requestClassification: RpcRequestClassifications.ChainManagement,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  wallet_getPermissions: {
    requestClassification: RpcRequestClassifications.AccountsAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.None,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "allow",
  },
  wallet_requestPermissions: {
    requestClassification: RpcRequestClassifications.AccountsAccess,
    connectionRequirement: ConnectionRequirements.None,
    approvalRequirement: ApprovalRequirements.Required,
    authorizedScopeCheck: AuthorizedScopeChecks.None,
    lockedType: "queue",
  },
  wallet_switchEthereumChain: {
    requestClassification: RpcRequestClassifications.ChainManagement,
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
      requestClassification: definition.requestClassification ?? null,
      connectionRequirement: definition.connectionRequirement,
      approvalRequirement: definition.approvalRequirement,
      authorizedScopeCheck: definition.authorizedScopeCheck,
      lockedType: definition.locked?.type ?? null,
    }).toEqual(expected);
  });
});
