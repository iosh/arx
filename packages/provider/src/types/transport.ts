import type { RequestArguments } from "./eip1193.js";

export type TransportMeta = {
  activeChainByNamespace: Record<string, string>;
  supportedChains: string[];
};

export type TransportRequestOptions = {
  timeoutMs?: number;
};

export type TransportDisconnectListener = (error?: unknown) => void;
export type TransportPatchListener<TPatch> = (patch: TPatch) => void;

export interface Transport<TSnapshot = unknown, TPatch = unknown> {
  bootstrap(): Promise<TSnapshot>;
  disconnect(): Promise<void>;
  destroy?(): void;
  isConnected(): boolean;
  request(args: RequestArguments, options?: TransportRequestOptions): Promise<unknown>;
  on(event: "disconnect", listener: TransportDisconnectListener): void;
  on(event: "patch", listener: TransportPatchListener<TPatch>): void;
  removeListener(event: "disconnect", listener: TransportDisconnectListener): void;
  removeListener(event: "patch", listener: TransportPatchListener<TPatch>): void;
}
