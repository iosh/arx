import { ZodError } from "zod";
import type { ChainRef } from "../networks/chainRef.js";
import { RpcInvalidParamsError } from "./errors.js";

export type DappRequest = Readonly<{
  origin: string;
  chainRef: ChainRef;
  method: string;
  params?: unknown;
}>;

export type DappRequestMethod = (input: DappRequest) => Promise<unknown>;

export const invalidDappParams = (method: string, reason: string): RpcInvalidParamsError =>
  new RpcInvalidParamsError({ message: `${method}: ${reason}` });

type DappMethodDefinition<Params> = Readonly<{
  decode(params: unknown, method: string): Params;
  execute(input: Readonly<{ origin: string; chainRef: ChainRef; params: Params }>): Promise<unknown>;
}>;

const decodeDappParams = <Params>(
  params: unknown,
  method: string,
  decode: (params: unknown, method: string) => Params,
): Params => {
  try {
    return decode(params, method);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RpcInvalidParamsError({
        message: `Invalid params for "${method}".`,
      });
    }

    throw error;
  }
};

export const defineDappMethod = <Params>(definition: DappMethodDefinition<Params>): DappRequestMethod => {
  return async (input) => {
    const params = decodeDappParams(input.params, input.method, definition.decode);
    return definition.execute({
      origin: input.origin,
      chainRef: input.chainRef,
      params,
    });
  };
};

export const decodeNoParams = (params: unknown, method: string): undefined => {
  if (params === undefined || params === null) return undefined;
  if (Array.isArray(params) && params.length === 0) return undefined;

  throw new RpcInvalidParamsError({
    message: `Method "${method}" does not accept params.`,
  });
};
