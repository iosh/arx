import type { ChainRef } from "../../../chains/ids.js";
import type { NetworkPreferencesRecord, NetworkRpcPreference } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type NetworkPreferencesChangedPayload = {
  next: NetworkPreferencesRecord;
};

export type NetworkPreferencesChangedHandler = (payload: NetworkPreferencesChangedPayload) => void;

export type UpdateNetworkPreferencesParams =
  | {
      activeChainRef?: ChainRef;

      // Full replace of rpc preferences.
      rpc?: Record<ChainRef, NetworkRpcPreference>;

      // Partial updates applied after `rpc` (if provided) or the stored value (if not).
      // Use null values to delete a chainRef entry.
      rpcPatch?: Record<ChainRef, NetworkRpcPreference | null>;

      clearRpc?: false | undefined;
    }
  | {
      activeChainRef?: ChainRef;

      // Clears all rpc preferences in a self-describing way.
      clearRpc: true;

      rpc?: never;
      rpcPatch?: Record<ChainRef, NetworkRpcPreference | null>;
    };

export type NetworkPreferencesService = {
  subscribeChanged(handler: NetworkPreferencesChangedHandler): Unsubscribe;

  get(): Promise<NetworkPreferencesRecord | null>;
  update(params: UpdateNetworkPreferencesParams): Promise<NetworkPreferencesRecord>;

  setActiveChainRef(chainRef: ChainRef): Promise<NetworkPreferencesRecord>;
  setRpcPreferences(rpc: Record<ChainRef, NetworkRpcPreference>): Promise<NetworkPreferencesRecord>;
  clearRpcPreferences(): Promise<NetworkPreferencesRecord>;
  patchRpcPreference(params: {
    chainRef: ChainRef;
    preference: NetworkRpcPreference | null;
  }): Promise<NetworkPreferencesRecord>;
};
