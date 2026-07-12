import { isArxBaseError } from "../../../errors.js";
import { RpcInternalError } from "../../../rpc/errors.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { SignedTransactionPayload } from "../types.js";
import type { Eip155BroadcasterContract } from "./types.js";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type BroadcasterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
};

export type Eip155Broadcaster = {
  broadcast(
    context: Parameters<Eip155BroadcasterContract["broadcast"]>[0],
    signed: SignedTransactionPayload,
  ): Promise<{
    hash: `0x${string}`;
  }>;
};

const toCanonicalTransactionHash = (value: unknown): `0x${string}` => {
  if (typeof value !== "string") {
    throw new RpcInternalError({
      message: "RPC node returned a non-string transaction hash.",
      details: {
        field: "hash",
        expected: "string",
      },
    });
  }
  if (!HASH_PATTERN.test(value)) {
    throw new RpcInternalError({
      message: "RPC node returned a transaction hash with invalid format.",
      details: {
        field: "hash",
        expected: "transaction hash",
      },
    });
  }
  return value.toLowerCase() as `0x${string}`;
};

export const createEip155Broadcaster = (deps: BroadcasterDeps): Eip155Broadcaster => {
  return {
    async broadcast(context, signed) {
      let client: Eip155RpcClient;
      try {
        client = deps.rpcClientFactory(context.chainRef);
      } catch (error) {
        throw new RpcInternalError({
          message: "Failed to create RPC client for the active chain.",
          cause: error,
        });
      }

      try {
        const hash = await client.sendRawTransaction(signed.raw);
        return { hash: toCanonicalTransactionHash(hash) };
      } catch (error) {
        if (isArxBaseError(error)) {
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

        throw new RpcInternalError({
          message: "Broadcast failed due to an unexpected error.",
          cause: error,
        });
      }
    },
  };
};
