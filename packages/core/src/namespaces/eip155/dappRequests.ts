import { z } from "zod";
import {
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
} from "../../accounts/errors.js";
import { ApprovalCancelledError, ApprovalRejectedError, ApprovalTimeoutError } from "../../approvals/errors.js";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { DappConnectionState } from "../../dappConnections/DappConnections.js";
import type { DappConnectionScope } from "../../dappConnections/persistence.js";
import {
  type DappNamespace,
  type DappRequest,
  decodeDappParams,
  decodeNoParams,
  defineDappMethod,
} from "../../dappConnections/routeDappRequest.js";
import type { JsonObject, JsonValue } from "../../errors.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { buildEip2255Permissions } from "../../permissions/eip2255.js";
import { PermissionAccountAccessUnavailableError } from "../../permissions/errors.js";
import { RpcUnauthorizedError, RpcUserRejectedRequestError } from "../../rpc/errors.js";
import { WalletLockedError } from "../../wallet/errors.js";
import { chainIdFromChainRef } from "./chainId.js";
import { EIP155_NAMESPACE } from "./constants.js";

type JsonRpcParams = JsonValue[] | JsonObject;

type CreateEip155DappNamespaceOptions = Readonly<{
  chainJsonRpc: ChainJsonRpc;
  getConnectionState(scope: DappConnectionScope): DappConnectionState;
  requestAccountAccess(input: Readonly<{ scope: DappConnectionScope; chainRef: ChainRef }>): Promise<void>;
  revokeAccountAccess(scope: DappConnectionScope): Promise<void>;
}>;

const JSON_RPC_PARAMS_SCHEMA: z.ZodType<JsonRpcParams> = z.union([z.array(z.json()), z.record(z.string(), z.json())]);

const EIP155_ACCOUNT_PERMISSION_PARAMS_SCHEMA = z.tuple([
  z.strictObject({
    eth_accounts: z.strictObject({}),
  }),
]);

const EIP155_NODE_READ_METHODS: ReadonlySet<string> = new Set(["eth_blockNumber"]);

const decodeJsonRpcParams = (params: unknown, method: string): JsonRpcParams | undefined => {
  if (params === undefined) return undefined;
  return decodeDappParams(params, method, (rawParams) => JSON_RPC_PARAMS_SCHEMA.parse(rawParams));
};

const decodeAccountPermissionRequest = (params: unknown): undefined => {
  EIP155_ACCOUNT_PERMISSION_PARAMS_SCHEMA.parse(params);
  return undefined;
};

const eip155ConnectionScope = (origin: string): DappConnectionScope => ({
  origin,
  namespace: EIP155_NAMESPACE,
});

const isAccountAccessRejected = (error: unknown): boolean =>
  error instanceof ApprovalRejectedError ||
  error instanceof ApprovalCancelledError ||
  error instanceof ApprovalTimeoutError;

const isAccountAccessUnavailable = (error: unknown): boolean =>
  error instanceof PermissionAccountAccessUnavailableError ||
  error instanceof WalletLockedError ||
  error instanceof AccountNotFoundError ||
  error instanceof AccountNamespaceMismatchError ||
  error instanceof AccountHiddenSelectionError;

export const createEip155DappNamespace = (options: CreateEip155DappNamespaceOptions): DappNamespace => {
  const getAccounts = (scope: DappConnectionScope): readonly string[] => options.getConnectionState(scope).accounts;

  const getPermissions = (scope: DappConnectionScope) =>
    buildEip2255Permissions({
      origin: scope.origin,
      accountAddresses: getAccounts(scope),
    });

  const requestAccountAccess = async (scope: DappConnectionScope, chainRef: ChainRef): Promise<void> => {
    try {
      await options.requestAccountAccess({ scope, chainRef });
    } catch (error) {
      if (isAccountAccessRejected(error)) throw new RpcUserRejectedRequestError();
      if (isAccountAccessUnavailable(error)) throw new RpcUnauthorizedError();
      throw error;
    }
  };

  return {
    localMethods: new Map([
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
            const state = options.getConnectionState(scope);
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
            const { chainRef } = options.getConnectionState(scope);

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
            await options.revokeAccountAccess(eip155ConnectionScope(origin));
            return null;
          },
        }),
      ],
    ]),
    nodeReadMethods: EIP155_NODE_READ_METHODS,
    forwardNodeRead: ({ chainRef, method, params }: DappRequest) => {
      const decodedParams = decodeJsonRpcParams(params, method);
      return options.chainJsonRpc.request({
        chainRef,
        method,
        ...(decodedParams !== undefined ? { params: decodedParams } : {}),
        replay: "allowed",
      });
    },
  };
};
