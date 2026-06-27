import type { MethodCall } from "../invoke/methods.js";
import { createMethodApiFromHandlers } from "../invoke/methods.js";
import type { WalletApi } from "./api.js";
import type { WalletApiContext } from "./context.js";
import { walletMethodHandlers } from "./methodHandlers.js";

export type WalletApiCall = MethodCall;

export const createWalletApiClient = (call: WalletApiCall): WalletApi =>
  createMethodApiFromHandlers<WalletApiContext, WalletApi>(walletMethodHandlers, call);
