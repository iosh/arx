import type { Caip2ChainId } from "./ids.js";

export type NormalizeAddressParams = {
  chainRef: Caip2ChainId;
  value: string;
};

export type NormalizedAddressResult<TMetadata = Record<string, unknown>> = {
  canonical: string;
  metadata?: TMetadata;
};

export type FormatAddressParams<TMetadata = Record<string, unknown>> = {
  chainRef: Caip2ChainId;
  canonical: string;
  metadata?: TMetadata;
};

export type ChainAddressModule<TMetadata = Record<string, unknown>> = {
  normalize(params: NormalizeAddressParams): NormalizedAddressResult<TMetadata>;
  format(params: FormatAddressParams<TMetadata>): string;
  validate?(params: FormatAddressParams<TMetadata>): void;
};

export type ChainDescriptor<TMetadata = Record<string, unknown>> = {
  namespace: string;
  supportsChain(chainRef: Caip2ChainId): boolean;
  address: ChainAddressModule<TMetadata>;
};
