import * as Hex from "ox/Hex";
import type { ChainModuleRegistry } from "../../../../chains/registry.js";
import type { TransactionAdapterContext } from "../../types.js";
import type { AddressResolutionResult, Eip155TransactionDraft } from "../types.js";
import { pushIssue, readErrorMessage } from "../utils/validation.js";

type AddressResolverDeps = {
  chains: ChainModuleRegistry;
};

// Create factory function instead of direct export
export const createAddressResolver = (deps: AddressResolverDeps) => {
  return (
    context: TransactionAdapterContext,
    payload: { from?: string | null; to?: string | null | undefined },
    issues: Eip155TransactionDraft["issues"],
  ): AddressResolutionResult => {
    const prepared: AddressResolutionResult["prepared"] = {};
    const summary: AddressResolutionResult["summary"] = {};

    const requestFrom = payload.from ?? null;
    const contextFrom = context.from ?? null;
    const resolvedFrom = requestFrom ?? contextFrom;

    if (!resolvedFrom) {
      pushIssue(issues, "transaction.draft.from_missing", "Transaction requires a from address.");
    } else {
      try {
        const normalized = deps.chains.toCanonicalAddress({ chainRef: context.chainRef, value: resolvedFrom });
        Hex.assert(normalized.canonical as Hex.Hex, { strict: false });
        prepared.from = normalized.canonical as Hex.Hex;
        summary.from = deps.chains.formatAddress({
          chainRef: context.chainRef,
          canonical: normalized.canonical,
        }) as Hex.Hex;

        if (requestFrom && contextFrom) {
          const requestCanonical = deps.chains.toCanonicalAddress({
            chainRef: context.chainRef,
            value: requestFrom,
          }).canonical;
          const contextCanonical = deps.chains.toCanonicalAddress({
            chainRef: context.chainRef,
            value: contextFrom,
          }).canonical;
          if (requestCanonical !== contextCanonical) {
            pushIssue(issues, "transaction.draft.from_mismatch", "Payload from does not match active account.", {
              payloadFrom: requestFrom,
              activeFrom: contextFrom,
            });
          }
        }
      } catch (error) {
        pushIssue(issues, "transaction.draft.from_invalid", "Invalid from address.", {
          address: resolvedFrom,
          error: readErrorMessage(error),
        });
      }
    }

    if ("to" in payload) {
      if (payload.to === null) {
        prepared.to = null;
        summary.to = null;
      } else if (payload.to !== undefined) {
        try {
          const normalized = deps.chains.toCanonicalAddress({ chainRef: context.chainRef, value: payload.to });
          Hex.assert(normalized.canonical as Hex.Hex, { strict: false });
          prepared.to = normalized.canonical as Hex.Hex;
          summary.to = deps.chains.formatAddress({
            chainRef: context.chainRef,
            canonical: normalized.canonical,
          }) as Hex.Hex;
        } catch (error) {
          pushIssue(issues, "transaction.draft.to_invalid", "Invalid to address.", {
            address: payload.to,
            error: readErrorMessage(error),
          });
        }
      }
    }

    return { prepared, summary };
  };
};
