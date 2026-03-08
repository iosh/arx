import type { RpcInvocationContext } from "@arx/core";
import type { TransportMeta } from "@arx/provider/types";

export type PortContext = {
  origin: string;
  meta: TransportMeta | null;
  chainRef: string | null;
  chainId: string | null;
  namespace: string | null;
};

export type ControllerSnapshot = {
  chain: { chainId: string; chainRef: string };
  accounts: string[];
  isUnlocked: boolean;
  meta: TransportMeta;
};

export type ArxRpcContext = {
  origin: string;
  arx?: (RpcInvocationContext & { meta: TransportMeta | null }) | undefined;
};
