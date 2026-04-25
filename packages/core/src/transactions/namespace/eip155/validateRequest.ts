import { ArxReasons, arxError } from "@arx/errors";
import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155TransactionPayload } from "../../types.js";
import type { TransactionValidationContext } from "../types.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import type { Eip155PreparedTransactionResult } from "./types.js";
import { deriveExpectedChainId } from "./utils/chainHelpers.js";
import { parseHexData, parseHexQuantity } from "./utils/validation.js";

const MIN_NETWORK_GAS_LIMIT = 21_000n;

type Deps = {
  chains: ChainAddressCodecRegistry;
};

const throwInvalidRequest = (message: string, data?: Record<string, unknown>): never => {
  throw arxError({
    reason: ArxReasons.RpcInvalidParams,
    message,
    ...(data ? { data } : {}),
  });
};

const findBlockingIssue = (issues: Eip155PreparedTransactionResult["issues"]) => {
  return issues.find((issue) => issue.kind === "issue") ?? null;
};

export const createEip155RequestValidator = (deps: Deps) => {
  const resolveAddresses = createAddressResolver({ chains: deps.chains });

  return (context: TransactionValidationContext): void => {
    const { request } = context;
    if (request.namespace !== "eip155") {
      throwInvalidRequest(`EIP-155 request validator cannot validate namespace "${request.namespace}"`, {
        namespace: request.namespace,
      });
    }

    const issues: Eip155PreparedTransactionResult["issues"] = [];
    const payload = request.payload as Eip155TransactionPayload;

    resolveAddresses(
      context,
      {
        from:
          payload && typeof payload === "object" && "from" in payload && typeof payload.from === "string"
            ? payload.from
            : null,
        to:
          payload &&
          typeof payload === "object" &&
          "to" in payload &&
          (typeof payload.to === "string" || payload.to === null)
            ? payload.to
            : undefined,
      },
      issues,
    );

    const addressIssue = findBlockingIssue(issues);
    if (addressIssue) {
      throwInvalidRequest(addressIssue.message, {
        code: addressIssue.code,
        ...(addressIssue.data !== undefined ? { details: addressIssue.data } : {}),
      });
    }

    parseHexQuantity(issues, payload.chainId, "chainId");
    parseHexQuantity(issues, payload.value, "value");
    parseHexData(issues, payload.data);
    const gas = parseHexQuantity(issues, payload.gas, "gas");
    const payloadGasPrice = parseHexQuantity(issues, payload.gasPrice, "gasPrice");
    const payloadMaxFee = parseHexQuantity(issues, payload.maxFeePerGas, "maxFeePerGas");
    const payloadPriorityFee = parseHexQuantity(issues, payload.maxPriorityFeePerGas, "maxPriorityFeePerGas");
    parseHexQuantity(issues, payload.nonce, "nonce");

    const fieldIssue = findBlockingIssue(issues);
    if (fieldIssue) {
      throwInvalidRequest(fieldIssue.message, {
        code: fieldIssue.code,
        ...(fieldIssue.data !== undefined ? { details: fieldIssue.data } : {}),
      });
    }

    const expectedChainId = deriveExpectedChainId(context.chainRef);
    const payloadChainId = parseHexQuantity(issues, payload.chainId, "chainId");
    if (payloadChainId && expectedChainId && payloadChainId !== expectedChainId) {
      throwInvalidRequest("chainId does not match active chain.", {
        code: "transaction.prepare.chain_id_mismatch",
        details: {
          payloadChainId,
          expectedChainId,
        },
      });
    }

    if (payloadGasPrice && (payloadMaxFee || payloadPriorityFee)) {
      throwInvalidRequest("Cannot mix legacy gasPrice with EIP-1559 fields.", {
        code: "transaction.prepare.fee_conflict",
        details: {
          gasPrice: payloadGasPrice,
          maxFeePerGas: payloadMaxFee,
          maxPriorityFeePerGas: payloadPriorityFee,
        },
      });
    }

    if ((payloadMaxFee && !payloadPriorityFee) || (!payloadMaxFee && payloadPriorityFee)) {
      throwInvalidRequest("EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.", {
        code: "transaction.prepare.fee_pair_incomplete",
        details: {
          maxFeePerGas: payloadMaxFee,
          maxPriorityFeePerGas: payloadPriorityFee,
        },
      });
    }

    if (gas) {
      const gasValue = BigInt(gas);
      if (gasValue < MIN_NETWORK_GAS_LIMIT) {
        throwInvalidRequest("gas must be at least 0x5208 for EVM transactions.", {
          code: "transaction.validation.gas_too_low",
          details: { gas, minimum: "0x5208" },
        });
      }
    }
  };
};
