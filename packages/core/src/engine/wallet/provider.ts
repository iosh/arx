import type { ProviderRuntimeAccess } from "../../runtime/provider/types.js";
import type { WalletDappConnections, WalletProvider } from "../types.js";
import type { DappConnectionWriter } from "./dappConnections.js";

export const createWalletProvider = (deps: {
  runtimeAccess: ProviderRuntimeAccess;
  dappConnections: Pick<WalletDappConnections, "isConnected"> & Pick<DappConnectionWriter, "record" | "remove">;
}): WalletProvider => {
  const { runtimeAccess, dappConnections } = deps;

  return {
    getConnectionState: async (input) => {
      const state = await runtimeAccess.buildConnectionState(input);
      return {
        ...state,
        connected:
          dappConnections.isConnected(input.origin, { namespace: input.namespace }) && state.accounts.length > 0,
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
    encodeRuntimeRpcError: (error) => runtimeAccess.encodeRuntimeRpcError(error),
    cancelRequestScope: (input) => runtimeAccess.cancelRequestScope(input),
    subscribeSessionUnlocked: (listener) => runtimeAccess.subscribeSessionUnlocked(listener),
    subscribeSessionLocked: (listener) => runtimeAccess.subscribeSessionLocked(listener),
  };
};
