import type { z } from "zod";

export declare const WalletOperationResultType: unique symbol;

export type WalletOperation<TInputSchema extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> = Readonly<{
  input: TInputSchema;
  readonly [WalletOperationResultType]?: TResult;
}>;

export type WalletOperations = Readonly<{
  [key: string]: WalletOperation | WalletOperations;
}>;

type StringKeyOf<T> = Extract<keyof T, string>;

export type WalletOperationPath<TTree extends WalletOperations, TPrefix extends string = ""> = {
  [K in StringKeyOf<TTree>]: TTree[K] extends WalletOperation
    ? `${TPrefix}${K}`
    : TTree[K] extends WalletOperations
      ? WalletOperationPath<TTree[K], `${TPrefix}${K}.`>
      : never;
}[StringKeyOf<TTree>];

export type WalletOperationAtPath<
  TOperations extends WalletOperations,
  TPath extends string,
> = TPath extends `${infer THead}.${infer TRest}`
  ? THead extends keyof TOperations
    ? TOperations[THead] extends WalletOperations
      ? WalletOperationAtPath<TOperations[THead], TRest>
      : never
    : never
  : TPath extends keyof TOperations
    ? TOperations[TPath] extends WalletOperation
      ? TOperations[TPath]
      : never
    : never;

export type WalletOperationInputAtPath<
  TOperations extends WalletOperations,
  TPath extends WalletOperationPath<TOperations>,
> =
  WalletOperationAtPath<TOperations, TPath> extends WalletOperation<infer TInputSchema, unknown>
    ? z.input<TInputSchema>
    : never;

export type WalletOperationResultAtPath<
  TOperations extends WalletOperations,
  TPath extends WalletOperationPath<TOperations>,
> = WalletOperationAtPath<TOperations, TPath> extends WalletOperation<z.ZodTypeAny, infer TResult> ? TResult : never;

type WalletOperationInput<TInputSchema extends z.ZodTypeAny> = {
  input: TInputSchema;
};

const buildWalletOperation = <const TInputSchema extends z.ZodTypeAny>(
  operation: WalletOperationInput<TInputSchema>,
) => ({
  input: operation.input,
});

export function defineWalletOperation<TResult>(): <const TInputSchema extends z.ZodTypeAny>(
  operation: WalletOperationInput<TInputSchema>,
) => WalletOperation<TInputSchema, TResult>;
export function defineWalletOperation<const TInputSchema extends z.ZodTypeAny>(
  operation: WalletOperationInput<TInputSchema>,
): WalletOperation<TInputSchema, unknown>;
export function defineWalletOperation(operation?: WalletOperationInput<z.ZodTypeAny>) {
  return operation === undefined ? buildWalletOperation : buildWalletOperation(operation);
}

export const isWalletOperation = (value: WalletOperation | WalletOperations): value is WalletOperation => {
  return "input" in value;
};
