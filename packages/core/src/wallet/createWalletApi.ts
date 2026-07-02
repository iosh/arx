import { createMethodApiProxy, createMethodExecutor, type MethodCall, type MethodExecutor } from "../invoke/methods.js";
import type { WalletApi } from "./api.js";
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
  const call: MethodCall = async <TResult>(path: string, input?: unknown): Promise<TResult> => {
    return (await executor.executePath(path, input)) as TResult;
  };
  return createMethodApiProxy<WalletApi>(call);
};

export const createWalletApi = (context: WalletApiContext): WalletApi => {
  return createWalletApiFromExecutor(createWalletMethodExecutor(context));
};
