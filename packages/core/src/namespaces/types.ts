export const SUPPORTED_NAMESPACES = ["eip155"] as const;

export type Namespace = (typeof SUPPORTED_NAMESPACES)[number];

export const isSupportedNamespace = (value: string): value is Namespace =>
  SUPPORTED_NAMESPACES.some((namespace) => namespace === value);
