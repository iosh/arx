import type { ProviderAccess } from "../../provider/access/types.js";
import type { WalletDappConnections, WalletProvider } from "../types.js";
import type { DappConnectionWriter } from "./dappConnections.js";

export const createWalletProvider = (deps: {
  runtimeAccess: ProviderAccess;
  dappConnections: Pick<WalletDappConnections, "isConnected"> & Pick<DappConnectionWriter, "record" | "remove">;
}): WalletProvider => {
  const { runtimeAccess, dappConnections } = deps;

  return {
    getConnectionState: async (input) => {
      const state = await runtimeAccess.buildConnectionState(input);
      return {
        ...state,
        connected: dappConnections.isConnected(input.origin, { namespace: input.namespace }),
      };
    },
    activateConnectionScope: async (input) => {
      const state = await runtimeAccess.activateConnectionScope(input);
      dappConnections.record(input, state);
      return state;
    },
    deactivateConnectionScope: (input) => {
      runtimeAccess.deactivateConnectionScope(input);
      dappConnections.remove(input);
    },
    subscribeConnectionStateChanged: (listener) => runtimeAccess.subscribeConnectionStateChanged(listener),
    request: (input) => runtimeAccess.request(input),
    encodeRpcError: (error) => runtimeAccess.encodeRpcError(error),
    cancelRequestScope: (input) => runtimeAccess.cancelRequestScope(input),
    subscribeSessionUnlocked: (listener) => runtimeAccess.subscribeSessionUnlocked(listener),
    subscribeSessionLocked: (listener) => runtimeAccess.subscribeSessionLocked(listener),
  };
};
