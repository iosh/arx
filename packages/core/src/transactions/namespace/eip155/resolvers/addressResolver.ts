import * as Hex from "ox/Hex";
import type { ChainAddressCodecRegistry } from "../../../../chains/registry.js";
import type { TransactionPrepareContext } from "../../types.js";
import type { AddressResolutionResult, Eip155PrepareStepResult } from "../types.js";
import { readErrorMessage } from "../utils/validation.js";

type AddressResolverDeps = {
  chains: ChainAddressCodecRegistry;
};

export const createAddressResolver = (deps: AddressResolverDeps) => {
  return (
    context: TransactionPrepareContext,
    payload: { from?: string | null; to?: string | null | undefined },
  ): Eip155PrepareStepResult<AddressResolutionResult["prepared"]> => {
    const prepared: AddressResolutionResult["prepared"] = {};

    const requestFrom = payload.from ?? null;
    const contextFrom = context.from ?? null;
    const resolvedFrom = requestFrom ?? contextFrom;

    if (!resolvedFrom) {
      return {
        status: "blocked",
        blocker: {
          reason: "transaction.prepare.from_missing",
          message: "Transaction requires a from address.",
        },
        patch: prepared,
      };
    } else {
      try {
        const normalized = deps.chains.toCanonicalAddress({ chainRef: context.chainRef, value: resolvedFrom });
        Hex.assert(normalized.canonical as Hex.Hex, { strict: false });
        prepared.from = normalized.canonical as Hex.Hex;

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
            return {
              status: "blocked",
              blocker: {
                reason: "transaction.prepare.from_mismatch",
                message: "Transaction from address does not match the selected account.",
                data: {
                  payloadFrom: requestFrom,
                  activeFrom: contextFrom,
                },
              },
              patch: prepared,
            };
          }
        }
      } catch (error) {
        return {
          status: "blocked",
          blocker: {
            reason: "transaction.prepare.from_invalid",
            message: "Transaction from address is invalid for the active chain.",
            data: {
              address: resolvedFrom,
              error: readErrorMessage(error),
            },
          },
          patch: prepared,
        };
      }
    }

    if ("to" in payload) {
      if (payload.to === null) {
        prepared.to = null;
      } else if (payload.to !== undefined) {
        try {
          const normalized = deps.chains.toCanonicalAddress({ chainRef: context.chainRef, value: payload.to });
          Hex.assert(normalized.canonical as Hex.Hex, { strict: false });
          prepared.to = normalized.canonical as Hex.Hex;
        } catch (error) {
          return {
            status: "blocked",
            blocker: {
              reason: "transaction.prepare.to_invalid",
              message: "Transaction recipient address is invalid for the active chain.",
              data: {
                address: payload.to,
                error: readErrorMessage(error),
              },
            },
            patch: prepared,
          };
        }
      }
    }

    return { status: "ok", patch: prepared };
  };
};
