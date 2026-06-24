import type { TrustedWalletApi } from "./api.js";
import { createTrustedWalletApiFromCall, type TrustedWalletApiCall } from "./apiFromCall.js";
import type { WalletApiContext } from "./context.js";
import { createWalletMethodExecutor, type WalletMethodExecutor } from "./executor.js";
import { walletMethodHandlers } from "./operationHandlers.js";

export type TrustedWalletMethodExecutor = WalletMethodExecutor;

export const createTrustedWalletMethodExecutor = (context: WalletApiContext): TrustedWalletMethodExecutor => {
  return createWalletMethodExecutor<WalletApiContext, TrustedWalletApi>({
    context,
    handlers: walletMethodHandlers,
  });
};

export const createTrustedWalletApiFromExecutor = (executor: WalletMethodExecutor): TrustedWalletApi => {
  const call: TrustedWalletApiCall = async <TResult>(path: string, input?: unknown): Promise<TResult> => {
    return (await executor.executeUnknownPath(path, input)) as TResult;
  };
  return createTrustedWalletApiFromCall(call);
};

export const createTrustedWalletApi = (context: WalletApiContext): TrustedWalletApi => {
  return createTrustedWalletApiFromExecutor(createTrustedWalletMethodExecutor(context));
};
