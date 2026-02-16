import type { ChainRef } from "./ids.js";

export type CanonicalizeAddressParams = {
  chainRef: ChainRef;
  value: string;
};

export type CanonicalizedAddressResult<TMetadata = Record<string, unknown>> = {
  canonical: string;
  metadata?: TMetadata;
};

export type FormatAddressParams<TMetadata = Record<string, unknown>> = {
  chainRef: ChainRef;
  canonical: string;
  metadata?: TMetadata;
};

export type ChainAddressModule<TMetadata = Record<string, unknown>> = {
  canonicalize(params: CanonicalizeAddressParams): CanonicalizedAddressResult<TMetadata>;
  format(params: FormatAddressParams<TMetadata>): string;
  validate?(params: FormatAddressParams<TMetadata>): void;
};

export type ChainDescriptor<TMetadata = Record<string, unknown>> = {
  namespace: string;
  address: ChainAddressModule<TMetadata>;
};
