import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { SignedTransactionPayload, TransactionAdapterContext } from "../types.js";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type BroadcasterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcCapabilities;
};

export type Eip155Broadcaster = {
  broadcast(context: TransactionAdapterContext, signed: SignedTransactionPayload): Promise<{ hash: string }>;
};

const toCanonicalTransactionHash = (value: unknown): string => {
  if (typeof value !== "string") {
    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: "RPC node returned a non-string transaction hash.",
      data: { hash: value },
    });
  }
  if (!HASH_PATTERN.test(value)) {
    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: "RPC node returned a transaction hash with invalid format.",
      data: { hash: value },
    });
  }
  return value.toLowerCase();
};

export const createEip155Broadcaster = (deps: BroadcasterDeps): Eip155Broadcaster => {
  return {
    async broadcast(context, signed) {
      let client: Eip155RpcCapabilities;
      try {
        client = deps.rpcClientFactory(context.chainRef);
      } catch (error) {
        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: "Failed to create RPC client for the active chain.",
          data: { chainRef: context.chainRef, error: error instanceof Error ? error.message : String(error) },
          cause: error,
        });
      }

      try {
        const hash = await client.sendRawTransaction(signed.raw);
        return { hash: toCanonicalTransactionHash(hash) };
      } catch (error) {
        if (isArxError(error)) {
          throw error;
        }
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code: unknown }).code === "number" &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ) {
          throw error;
        }

        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: "Broadcast failed due to an unexpected error.",
          data: {
            chainRef: context.chainRef,
            origin: context.origin,
            error: error instanceof Error ? error.message : String(error),
          },
          cause: error,
        });
      }
    },
  };
};
