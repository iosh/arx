import type { ChainMetadata } from "../../chains/metadata.js";
import type { RpcRoutingState, RpcStrategyConfig } from "../../controllers/network/types.js";

export const UNKNOWN_ORIGIN = "unknown://";
export const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };

export const buildDefaultRoutingState = (
  metadata: Pick<ChainMetadata, "chainRef" | "rpcEndpoints">,
  strategy?: RpcStrategyConfig,
): RpcRoutingState => {
  if (metadata.rpcEndpoints.length === 0) {
    throw new Error(`Chain ${metadata.chainRef} must declare at least one RPC endpoint`);
  }
  return {
    activeIndex: 0,
    strategy: strategy
      ? { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined }
      : { ...DEFAULT_STRATEGY },
  };
};
