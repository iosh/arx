export type RpcEndpointType = "public" | "authenticated" | "private";

export type RpcEndpointInfo = {
  index: number;
  url: string;
  type?: RpcEndpointType | undefined;
  weight?: number | undefined;
  headers?: Record<string, string> | undefined;
};

export type RpcErrorSnapshot = {
  message: string;
  code?: number | string | undefined;
  data?: unknown;
  capturedAt: number;
};

export type RpcEndpointHealth = {
  index: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastError?: RpcErrorSnapshot | undefined;
  lastFailureAt?: number | undefined;
  cooldownUntil?: number | undefined;
};

export type RpcStrategy = {
  id: string;
  options?: Record<string, unknown> | undefined;
};

export type RpcEndpointState = {
  activeIndex: number;
  endpoints: RpcEndpointInfo[];
  health: RpcEndpointHealth[];
  strategy: RpcStrategy;
  lastUpdatedAt: number;
};
