import {
  isWalletOperation,
  type WalletOperation,
  type WalletOperationInputAtPath,
  type WalletOperationPath,
  type WalletOperationResultAtPath,
  type WalletOperations,
} from "./operation.js";

type WalletOperationClientArgs<TInput> = undefined extends TInput ? [input?: TInput] : [input: TInput];

export type WalletOperationClient<TOperations extends WalletOperations> = Readonly<{
  [K in keyof TOperations]: TOperations[K] extends WalletOperation
    ? (
        ...args: WalletOperationClientArgs<
          WalletOperationInputAtPath<TOperations, K & WalletOperationPath<TOperations>>
        >
      ) => Promise<WalletOperationResultAtPath<TOperations, K & WalletOperationPath<TOperations>>>
    : TOperations[K] extends WalletOperations
      ? WalletOperationClient<TOperations[K]>
      : never;
}>;

type WalletOperationClientCall<TOperations extends WalletOperations> = (
  path: WalletOperationPath<TOperations>,
  input: unknown,
) => Promise<unknown>;

type WalletOperationClientMethod = (input?: unknown) => Promise<unknown>;

interface WalletOperationClientNode {
  [key: string]: WalletOperationClientMethod | WalletOperationClientNode;
}

export const createWalletOperationClient = <TOperations extends WalletOperations>(deps: {
  operations: TOperations;
  call: WalletOperationClientCall<TOperations>;
}): WalletOperationClient<TOperations> => {
  const buildNode = (operationBranch: WalletOperations, segments: string[]): WalletOperationClientNode => {
    const clientNode: WalletOperationClientNode = {};

    for (const [key, childNode] of Object.entries(operationBranch)) {
      const pathSegments = [...segments, key];
      const path = pathSegments.join(".") as WalletOperationPath<TOperations>;

      if (isWalletOperation(childNode)) {
        clientNode[key] = (input?: unknown) => deps.call(path, input);
        continue;
      }

      clientNode[key] = buildNode(childNode, pathSegments);
    }

    return clientNode;
  };

  return buildNode(deps.operations, []) as WalletOperationClient<TOperations>;
};
