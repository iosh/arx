import type { z } from "zod";

export type WalletOperationDescriptor<TInputSchema extends z.ZodTypeAny = z.ZodTypeAny> = Readonly<{
  input: TInputSchema;
}>;

export type WalletOperationDescriptorTree = Readonly<{
  [key: string]: WalletOperationDescriptor | WalletOperationDescriptorTree;
}>;

type StringKeyOf<T> = Extract<keyof T, string>;

export type WalletOperationPath<TTree extends WalletOperationDescriptorTree, TPrefix extends string = ""> = {
  [K in StringKeyOf<TTree>]: TTree[K] extends WalletOperationDescriptor
    ? `${TPrefix}${K}`
    : TTree[K] extends WalletOperationDescriptorTree
      ? WalletOperationPath<TTree[K], `${TPrefix}${K}.`>
      : never;
}[StringKeyOf<TTree>];

export const defineWalletOperation = <const TInputSchema extends z.ZodTypeAny>(descriptor: {
  input: TInputSchema;
}): WalletOperationDescriptor<TInputSchema> => ({
  input: descriptor.input,
});

export const isWalletOperationDescriptor = (value: unknown): value is WalletOperationDescriptor => {
  if (!value || typeof value !== "object") return false;
  const input = (value as { input?: unknown }).input;
  return Boolean(input && typeof input === "object" && typeof (input as { parse?: unknown }).parse === "function");
};
