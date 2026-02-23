import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { NetworkState, RpcEndpointChange, RpcEndpointHealth } from "./types.js";

export const NETWORK_STATE_CHANGED = stateTopic<NetworkState>("network:stateChanged", {
  // revision is the canonical monotonic change indicator.
  isEqual: (prev, next) => prev.revision === next.revision,
});

export const NETWORK_ACTIVE_CHAIN_CHANGED = eventTopic<{ previous: ChainRef; next: ChainRef }>(
  "network:activeChainChanged",
);

export const NETWORK_CHAIN_METADATA_CHANGED = eventTopic<{
  chainRef: ChainRef;
  previous: ChainMetadata | null;
  next: ChainMetadata | null;
}>("network:chainMetadataChanged");

export const NETWORK_RPC_ENDPOINT_CHANGED = eventTopic<RpcEndpointChange>("network:rpcEndpointChanged");

export const NETWORK_RPC_HEALTH_CHANGED = eventTopic<{ chainRef: ChainRef; health: RpcEndpointHealth[] }>(
  "network:rpcHealthChanged",
);

export const NETWORK_TOPICS = [
  NETWORK_STATE_CHANGED,
  NETWORK_ACTIVE_CHAIN_CHANGED,
  NETWORK_CHAIN_METADATA_CHANGED,
  NETWORK_RPC_ENDPOINT_CHANGED,
  NETWORK_RPC_HEALTH_CHANGED,
] as const;

export type NetworkMessenger = ScopedMessenger<typeof NETWORK_TOPICS>;
