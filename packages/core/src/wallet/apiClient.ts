import type { MethodCall } from "../invoke/methods.js";
import { createMethodApiProxy } from "../invoke/methods.js";
import type { WalletApi } from "./api.js";

export type WalletApiCall = MethodCall;

export const createWalletApiClient = (call: WalletApiCall): WalletApi =>
  createMethodApiProxy<WalletApi>(call);
