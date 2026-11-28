import { z } from "zod";
import type { Approvals } from "../../approvals/Approvals.js";
import type { DappConnections } from "../../dappConnections/DappConnections.js";
import { type DappRequestMethod, defineDappMethod } from "../../dappConnections/defineDappMethod.js";
import { RpcInvalidParamsError, RpcUnrecognizedChainError } from "../../dappConnections/errors.js";
import {
  NetworkAlreadyExistsError,
  NetworkNotFoundError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
} from "../../networks/errors.js";
import type { Networks } from "../../networks/Networks.js";
import { chainIdFromChainRef, chainRefFromChainId, type Eip155ChainRef } from "./chainId.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { chainIdParam } from "./dappChainId.js";
import { decodeAddEthereumChainParams } from "./eip3085.js";

type CreateEip155DappNetworkHandlersOptions = Readonly<{
  networks: Pick<Networks, "get" | "addCustom">;
  dappConnections: Pick<DappConnections, "selectNetwork">;
  approvals: Pick<Approvals, "request">;
}>;

const SWITCH_ETHEREUM_CHAIN_PARAMS_SCHEMA = z.tuple(
  [z.object({ chainId: chainIdParam })],
  "Expected a single parameter object.",
);

const unrecognizedChain = (chainRef: Eip155ChainRef): RpcUnrecognizedChainError =>
  new RpcUnrecognizedChainError({
    message: `Unrecognized chain ID "0x${chainIdFromChainRef(chainRef).toString(16)}".`,
    details: { chainRef },
  });

export const createEip155DappNetworkHandlers = (
  options: CreateEip155DappNetworkHandlersOptions,
): Readonly<{
  switchEthereumChain: DappRequestMethod;
  addEthereumChain: DappRequestMethod;
}> => ({
  switchEthereumChain: defineDappMethod({
    decode: (params) => {
      const [{ chainId }] = SWITCH_ETHEREUM_CHAIN_PARAMS_SCHEMA.parse(params);
      return chainRefFromChainId(chainId);
    },
    execute: async ({ origin, chainRef, params: targetChainRef }) => {
      if (targetChainRef === chainRef) return null;

      const currentNetwork = options.networks.get(chainRef);
      if (!currentNetwork) {
        throw new Error("The active EIP-155 network is unavailable.");
      }
      const targetNetwork = options.networks.get(targetChainRef);
      if (!targetNetwork) throw unrecognizedChain(targetChainRef);

      const approval = options.approvals.request<"switchNetwork">({
        type: "switchNetwork",
        namespace: EIP155_NAMESPACE,
        origin,
        request: { currentNetwork, targetNetwork },
      });
      await approval.decision;

      try {
        await options.dappConnections.selectNetwork({
          origin,
          namespace: EIP155_NAMESPACE,
          chainRef: targetChainRef,
        });
      } catch (error) {
        if (error instanceof NetworkNotFoundError) throw unrecognizedChain(targetChainRef);
        throw error;
      }
      return null;
    },
  }),
  addEthereumChain: defineDappMethod({
    decode: decodeAddEthereumChainParams,
    execute: async ({ origin, params }) => {
      if (options.networks.get(params.definition.chainRef)) return null;

      const approval = options.approvals.request<"addNetwork">({
        type: "addNetwork",
        namespace: EIP155_NAMESPACE,
        origin,
        request: params,
      });
      await approval.decision;

      if (options.networks.get(params.definition.chainRef)) return null;

      try {
        await options.networks.addCustom(params);
      } catch (error) {
        if (error instanceof NetworkAlreadyExistsError) return null;
        if (
          error instanceof NetworkRpcEndpointInvalidError ||
          error instanceof NetworkRpcEndpointMismatchError ||
          error instanceof NetworkRpcEndpointReadError
        ) {
          throw new RpcInvalidParamsError({ message: error.message });
        }
        throw error;
      }
      return null;
    },
  }),
});
