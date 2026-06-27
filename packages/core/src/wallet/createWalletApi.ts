import { createMethodExecutor, type MethodExecutor } from "../invoke/methods.js";
import type { WalletApi } from "./api.js";
import { createWalletApiClient, type WalletApiCall } from "./apiClient.js";
import type { WalletApiContext } from "./context.js";
import { walletMethodHandlers } from "./methodHandlers.js";

export type WalletMethodExecutor = MethodExecutor;

export const createWalletMethodExecutor = (context: WalletApiContext): WalletMethodExecutor => {
  return createMethodExecutor<WalletApiContext, WalletApi>({
    context,
    handlers: walletMethodHandlers,
  });
};

export const createWalletApiFromExecutor = (executor: MethodExecutor): WalletApi => {
  const call: WalletApiCall = async <TResult>(path: string, input?: unknown): Promise<TResult> => {
    return (await executor.executePath(path, input)) as TResult;
  };
  return createWalletApiClient(call);
};

export const createWalletApi = (context: WalletApiContext): WalletApi => {
  return createWalletApiFromExecutor(createWalletMethodExecutor(context));
};
