import type { ChainRef } from "./ids.js";

export type NormalizeAddressParams = {
  chainRef: ChainRef;
  value: string;
};

export type NormalizedAddressResult<TMetadata = Record<string, unknown>> = {
  canonical: string;
  metadata?: TMetadata;
};

export type FormatAddressParams<TMetadata = Record<string, unknown>> = {
  chainRef: ChainRef;
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
  supportsChain(chainRef: ChainRef): boolean;
  address: ChainAddressModule<TMetadata>;
};
