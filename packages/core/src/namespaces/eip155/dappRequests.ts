import { z } from "zod";
import type { Accounts } from "../../accounts/Accounts.js";
import {
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
} from "../../accounts/errors.js";
import type { Approvals } from "../../approvals/Approvals.js";
import { isApprovalDecisionError } from "../../approvals/errors.js";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { JsonRpcParams } from "../../chainJsonRpc/types.js";
import type { DappConnections } from "../../dappConnections/DappConnections.js";
import type { DappConnectionScope } from "../../dappConnections/persistence.js";
import { type DappNamespace, decodeNoParams, defineDappMethod } from "../../dappConnections/routeDappRequest.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { Networks } from "../../networks/Networks.js";
import type { DappAuthorization } from "../../permissions/createDappAuthorization.js";
import { buildEip2255Permissions } from "../../permissions/eip2255.js";
import { PermissionAccountAccessUnavailableError } from "../../permissions/errors.js";
import type { PermissionsReader } from "../../permissions/Permissions.js";
import { RpcUnauthorizedError, RpcUserRejectedRequestError } from "../../rpc/errors.js";
import type { Transactions } from "../../transactions/Transactions.js";
import { WalletLockedError } from "../../wallet/errors.js";
import type { Eip155AccountSigning } from "./accountSigning.js";
import { chainIdFromChainRef } from "./chainId.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { createEip155DappNetworkHandlers } from "./dappNetworks.js";
import { createEip155DappSigningHandlers } from "./dappSigning.js";
import { createEip155DappTransactionHandlers } from "./dappTransactions.js";

type CreateEip155DappNamespaceOptions = Readonly<{
  chainJsonRpc: ChainJsonRpc;
  dappConnections: Pick<DappConnections, "getConnectionState" | "selectNetwork">;
  dappAuthorization: Readonly<{
    requestAccountAccess: DappAuthorization["requestAccountAccess"];
    permissions: Pick<DappAuthorization["permissions"], "revoke">;
  }>;
  accounts: Pick<Accounts, "accountIdFromAddress" | "getAccount" | "getAddress">;
  permissions: Pick<PermissionsReader, "get">;
  approvals: Pick<Approvals, "request">;
  accountSigning: Eip155AccountSigning;
  networks: Pick<Networks, "get" | "addCustom">;
  transactions: Pick<Transactions, "prepare" | "submit">;
}>;

const EIP155_ACCOUNT_PERMISSION_PARAMS_SCHEMA = z.tuple([
  z.strictObject({
    eth_accounts: z.strictObject({}),
  }),
]);

const EIP155_NODE_READ_METHODS: ReadonlySet<string> = new Set([
  "eth_blockNumber",
  "eth_syncing",
  "net_version",
  "web3_clientVersion",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getProof",
  "eth_call",
  "eth_estimateGas",
  "eth_createAccessList",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);

const decodeAccountPermissionRequest = (params: unknown): undefined => {
  EIP155_ACCOUNT_PERMISSION_PARAMS_SCHEMA.parse(params);
  return undefined;
};

const eip155ConnectionScope = (origin: string): DappConnectionScope => ({
  origin,
  namespace: EIP155_NAMESPACE,
});

const isAccountAccessUnavailable = (error: unknown): boolean =>
  error instanceof PermissionAccountAccessUnavailableError ||
  error instanceof WalletLockedError ||
  error instanceof AccountNotFoundError ||
  error instanceof AccountNamespaceMismatchError ||
  error instanceof AccountHiddenSelectionError;

export const createEip155DappNamespace = (options: CreateEip155DappNamespaceOptions): DappNamespace => {
  const getAccounts = (scope: DappConnectionScope): readonly string[] =>
    options.dappConnections.getConnectionState(scope).accounts;

  const getPermissions = (scope: DappConnectionScope) =>
    buildEip2255Permissions({
      origin: scope.origin,
      accountAddresses: getAccounts(scope),
    });

  const requestAccountAccess = async (scope: DappConnectionScope, chainRef: ChainRef): Promise<void> => {
    try {
      await options.dappAuthorization.requestAccountAccess({ scope, chainRef });
    } catch (error) {
      if (isApprovalDecisionError(error)) throw new RpcUserRejectedRequestError();
      if (isAccountAccessUnavailable(error)) throw new RpcUnauthorizedError();
      throw error;
    }
  };

  const signingHandlers = createEip155DappSigningHandlers({
    accounts: options.accounts,
    permissions: options.permissions,
    approvals: options.approvals,
    accountSigning: options.accountSigning,
  });
  const transactionHandlers = createEip155DappTransactionHandlers({
    accounts: options.accounts,
    permissions: options.permissions,
    approvals: options.approvals,
    transactions: options.transactions,
  });
  const networkHandlers = createEip155DappNetworkHandlers({
    networks: options.networks,
    dappConnections: options.dappConnections,
    approvals: options.approvals,
  });

  return {
    namespaceMethods: new Map([
      [
        "eth_chainId",
        defineDappMethod({
          decode: decodeNoParams,
          execute: async ({ chainRef }) => `0x${chainIdFromChainRef(chainRef).toString(16)}`,
        }),
      ],
      [
        "eth_accounts",
        defineDappMethod({
          decode: decodeNoParams,
          execute: async ({ origin }) => getAccounts(eip155ConnectionScope(origin)),
        }),
      ],
      [
        "eth_requestAccounts",
        defineDappMethod({
          decode: decodeNoParams,
          execute: async ({ origin }) => {
            const scope = eip155ConnectionScope(origin);
            const state = options.dappConnections.getConnectionState(scope);
            if (state.accounts.length > 0) return state.accounts;

            await requestAccountAccess(scope, state.chainRef);
            return getAccounts(scope);
          },
        }),
      ],
      [
        "wallet_getPermissions",
        defineDappMethod({
          decode: decodeNoParams,
          execute: async ({ origin }) => getPermissions(eip155ConnectionScope(origin)),
        }),
      ],
      [
        "wallet_requestPermissions",
        defineDappMethod({
          decode: decodeAccountPermissionRequest,
          execute: async ({ origin }) => {
            const scope = eip155ConnectionScope(origin);
            const { chainRef } = options.dappConnections.getConnectionState(scope);

            await requestAccountAccess(scope, chainRef);
            return getPermissions(scope);
          },
        }),
      ],
      [
        "wallet_revokePermissions",
        defineDappMethod({
          decode: decodeAccountPermissionRequest,
          execute: async ({ origin }) => {
            await options.dappAuthorization.permissions.revoke(eip155ConnectionScope(origin));
            return null;
          },
        }),
      ],
      ["personal_sign", signingHandlers.personalSign],
      ["eth_signTypedData_v4", signingHandlers.signTypedDataV4],
      ["eth_sendTransaction", transactionHandlers.sendTransaction],
      ["wallet_switchEthereumChain", networkHandlers.switchEthereumChain],
      ["wallet_addEthereumChain", networkHandlers.addEthereumChain],
    ]),
    nodeReadMethods: EIP155_NODE_READ_METHODS,
    forwardNodeRead: ({ chainRef, method, params }) =>
      options.chainJsonRpc.request({
        chainRef,
        method,
        ...(params !== undefined ? { params: params as JsonRpcParams } : {}),
        replay: "allowed",
      }),
  };
};
