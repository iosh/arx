export type NamespaceTransactionOperation =
  | "request.deriveForChain"
  | "request.validateRequest"
  | "proposal.prepare"
  | "proposal.buildReview"
  | "proposal.applyDraftEdit"
  | "submission.createBroadcastArtifact"
  | "submission.broadcast"
  | "tracking.inspectSubmittedTransaction";

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
