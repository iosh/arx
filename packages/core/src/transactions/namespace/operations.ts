export type NamespaceTransactionOperation =
  | "request.deriveForChain"
  | "request.validate"
  | "proposal.prepare"
  | "proposal.buildReview"
  | "proposal.applyDraftEdit"
  | "execution.sign"
  | "execution.broadcast"
  | "tracking.fetchReceipt"
  | "tracking.detectReplacement"
  | "tracking.deriveReplacementKey";

export const createMissingNamespaceTransactionOperationError = (params: {
  namespace: string;
  operation: NamespaceTransactionOperation;
}): Error => {
  const error = new Error(`Namespace transaction "${params.namespace}" does not implement ${params.operation}.`);
  error.name = "NamespaceTransactionOperationMissingError";
  return error;
};

export const requireNamespaceTransactionOperation = <T>(params: {
  namespace: string;
  operation: NamespaceTransactionOperation;
  value: T | undefined;
}): T => {
  if (params.value !== undefined) {
    return params.value;
  }

  throw createMissingNamespaceTransactionOperationError({
    namespace: params.namespace,
    operation: params.operation,
  });
};
