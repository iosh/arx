import { ArxBaseError } from "../errors.js";

export type ProviderChainSelectionInvalidKeyField = "origin" | "namespace";

export class ProviderChainSelectionInvalidKeyError extends ArxBaseError {
  static readonly code = "provider_chain_selection.invalid_key";

  constructor(params: { field: ProviderChainSelectionInvalidKeyField; value: string }) {
    super("Invalid provider chain selection key.", {
      code: ProviderChainSelectionInvalidKeyError.code,
      details: {
        field: params.field,
        value: params.value,
      },
    });
  }
}
