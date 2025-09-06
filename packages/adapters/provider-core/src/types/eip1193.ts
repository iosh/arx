export interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface EIP1193Events {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface EIP1193Provider extends EIP1193Events {
  request(args: RequestArguments): Promise<unknown>;
  isConnected(): boolean;
}

export interface EIP1193ProviderRpcError {
  code: number;
  message: string;
  data?: unknown;
}
