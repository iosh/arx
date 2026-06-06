export const createMissingNamespaceTransactionError = (namespace: string): Error => {
  const error = new Error(`No namespace transaction registered for namespace ${namespace}`);
  error.name = "NamespaceTransactionMissingError";
  return error;
};
