import { ArxReasons, arxError } from "@arx/errors";
import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155TransactionPayload } from "../../types.js";
import type { TransactionValidationContext } from "../types.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import { deriveExpectedChainId } from "./utils/chainHelpers.js";
import { Eip155FieldParseError, parseOptionalHexData, parseOptionalHexQuantity } from "./utils/validation.js";

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

const runRequestParser = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Eip155FieldParseError) {
      throwInvalidRequest(error.message, {
        code: error.reason,
        details: {
          field: error.field,
          value: error.value,
          error: error.parseMessage,
        },
      });
    }
    throw error;
  }
};

const parseRequestHexQuantity = (value: string | undefined, field: string) =>
  runRequestParser(() => parseOptionalHexQuantity(value, field));

const parseRequestHexData = (value: string | undefined) => {
  return runRequestParser(() => parseOptionalHexData(value));
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

    const payload = request.payload as Eip155TransactionPayload;

    const addressResult = resolveAddresses(context, {
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
    });

    if (addressResult.status !== "ok") {
      const issue = addressResult.status === "blocked" ? addressResult.blocker : addressResult.error;
      throwInvalidRequest(issue.message, {
        code: issue.reason,
        ...(issue.data !== undefined ? { details: issue.data } : {}),
      });
    }

    const payloadChainId = parseRequestHexQuantity(payload.chainId, "chainId");
    parseRequestHexQuantity(payload.value, "value");
    parseRequestHexData(payload.data);
    const gas = parseRequestHexQuantity(payload.gas, "gas");
    const payloadGasPrice = parseRequestHexQuantity(payload.gasPrice, "gasPrice");
    const payloadMaxFee = parseRequestHexQuantity(payload.maxFeePerGas, "maxFeePerGas");
    const payloadPriorityFee = parseRequestHexQuantity(payload.maxPriorityFeePerGas, "maxPriorityFeePerGas");
    parseRequestHexQuantity(payload.nonce, "nonce");

    const expectedChainId = deriveExpectedChainId(context.chainRef);
    if (payloadChainId && expectedChainId && payloadChainId !== expectedChainId) {
      throwInvalidRequest("Transaction chainId does not match the active chain.", {
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
