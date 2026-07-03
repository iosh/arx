import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import { RpcInvalidParamsError } from "../../../rpc/errors.js";
import type { TransactionValidationContext } from "../types.js";
import { createAddressResolver } from "./resolvers/addressResolver.js";
import type { Eip155TransactionPayload } from "./transactionTypes.js";
import { deriveExpectedChainId } from "./utils/chainHelpers.js";
import { Eip155FieldParseError, parseOptionalHexData, parseOptionalHexQuantity } from "./utils/validation.js";

const MIN_NETWORK_GAS_LIMIT = 21_000n;

type Deps = {
  chains: ChainAddressingByNamespace;
};

const runRequestParser = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Eip155FieldParseError) {
      throw new RpcInvalidParamsError({
        message: error.message,
        details: {
          code: error.reason,
          field: error.field,
        },
        cause: error,
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
      throw new RpcInvalidParamsError({
        message: `EIP-155 request validator cannot validate namespace "${request.namespace}"`,
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
      throw new RpcInvalidParamsError({
        message: issue.message,
        details: {
          code: issue.reason,
        },
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
      throw new RpcInvalidParamsError({
        message: "Transaction chainId does not match the active chain.",
        details: {
          code: "transaction.prepare.chain_id_mismatch",
        },
      });
    }

    if (payloadGasPrice && (payloadMaxFee || payloadPriorityFee)) {
      throw new RpcInvalidParamsError({
        message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
        details: {
          code: "transaction.prepare.fee_conflict",
        },
      });
    }

    if ((payloadMaxFee && !payloadPriorityFee) || (!payloadMaxFee && payloadPriorityFee)) {
      throw new RpcInvalidParamsError({
        message: "EIP-1559 requires both maxFeePerGas and maxPriorityFeePerGas.",
        details: {
          code: "transaction.prepare.fee_pair_incomplete",
        },
      });
    }

    if (gas) {
      const gasValue = BigInt(gas);
      if (gasValue < MIN_NETWORK_GAS_LIMIT) {
        throw new RpcInvalidParamsError({
          message: "gas must be at least 0x5208 for EVM transactions.",
          details: {
            code: "transaction.validation.gas_too_low",
          },
        });
      }
    }
  };
};
