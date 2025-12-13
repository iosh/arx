import type { ProviderErrorFactory, RpcErrorFactory, RpcInvocationContext, UnlockReason } from "@arx/core";
import type { TransportMeta } from "@arx/provider-core/types";

export type SessionMessage =
  | { type: "session:getStatus" }
  | { type: "session:unlock"; payload: { password: string } }
  | { type: "session:lock"; payload?: { reason?: UnlockReason } }
  | { type: "vault:initialize"; payload: { password: string } };

export type PortContext = {
  origin: string;
  meta: TransportMeta | null;
  caip2: string | null;
  chainId: string | null;
  namespace: string;
};

export type ControllerSnapshot = {
  chain: { chainId: string; caip2: string };
  accounts: string[];
  isUnlocked: boolean;
  meta: TransportMeta;
};

export type ErrorFactoriesForRequest = {
  provider: ProviderErrorFactory;
  rpc: RpcErrorFactory;
};

export type ArxRpcContext = {
  origin: string;
  arx?: (RpcInvocationContext & { meta: TransportMeta | null; errors: ErrorFactoriesForRequest }) | undefined;
};
