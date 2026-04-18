import type { ProviderRuntimeAccess } from "../../runtime/provider/types.js";
import type { WalletDappConnections, WalletProvider, WalletSnapshots } from "../types.js";

export const createWalletProvider = (deps: {
  runtimeAccess: ProviderRuntimeAccess;
  dappConnections: Pick<
    WalletDappConnections,
    "buildConnectionProjection" | "connect" | "disconnect" | "disconnectOrigin"
  >;
  snapshots: Pick<WalletSnapshots, "buildProviderSnapshot">;
}): WalletProvider => {
  const { runtimeAccess, dappConnections, snapshots } = deps;

  return {
    buildSnapshot: (namespace) => snapshots.buildProviderSnapshot(namespace),
    buildConnectionProjection: (input) => dappConnections.buildConnectionProjection(input),
    executeRpcRequest: (request) => runtimeAccess.executeRpcRequest(request),
    encodeRpcError: (error, context) => runtimeAccess.encodeRpcError(error, context),
    connect: (input) => {
      dappConnections.connect(input);
      return dappConnections.buildConnectionProjection(input);
    },
    disconnect: (input) => {
      dappConnections.disconnect(input);
      return dappConnections.buildConnectionProjection(input);
    },
    disconnectOrigin: (origin) => dappConnections.disconnectOrigin(origin),
    cancelSessionApprovals: (input) => runtimeAccess.cancelSessionApprovals(input),
    subscribeSessionUnlocked: (listener) => runtimeAccess.subscribeSessionUnlocked(listener),
    subscribeSessionLocked: (listener) => runtimeAccess.subscribeSessionLocked(listener),
    subscribeNetworkStateChanged: (listener) => runtimeAccess.subscribeNetworkStateChanged(listener),
    subscribeNetworkSelectionChanged: (listener) => runtimeAccess.subscribeNetworkSelectionChanged(listener),
    subscribeAccountsStateChanged: (listener) => runtimeAccess.subscribeAccountsStateChanged(listener),
    subscribePermissionsStateChanged: (listener) => runtimeAccess.subscribePermissionsStateChanged(listener),
  };
};
