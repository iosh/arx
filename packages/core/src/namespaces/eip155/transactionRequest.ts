import { type Address, Hex } from "ox";
import { z } from "zod";
import { invalidDappParams } from "../../dappConnections/defineDappMethod.js";
import type * as Eip155 from "../../transactions/eip155/types.js";
import { parseAddress } from "./address.js";
import { chainIdParam } from "./dappChainId.js";
import { hexQuantity } from "./hexQuantity.js";

const address = z.string().transform((value, ctx) => {
  const parsed = parseAddress(value);
  if (parsed !== null) return parsed;
  ctx.addIssue({ code: "custom", message: "Expected a valid EIP-155 address." });
  return z.NEVER;
});

const hexBytes = z
  .string()
  .toLowerCase()
  .refine(
    (value): value is Hex.Hex => Hex.validate(value, { strict: true, even: true }),
    "Expected complete hexadecimal bytes with a 0x prefix.",
  );

const sendTransactionParams = z.tuple([
  z.strictObject({
    from: address,
    to: address.nullable().optional(),
    value: hexQuantity.optional(),
    data: hexBytes.optional(),
    gas: hexQuantity.optional(),
    nonce: z.string().optional(),
    chainId: chainIdParam.optional(),
    type: hexQuantity.optional(),
    gasPrice: hexQuantity.optional(),
    maxFeePerGas: hexQuantity.optional(),
    maxPriorityFeePerGas: hexQuantity.optional(),
    accessList: z
      .array(
        z.strictObject({
          address,
          storageKeys: z.array(hexBytes.refine((value) => Hex.size(value) === 32, "Expected a 32-byte storage key.")),
        }),
      )
      .optional(),
  }),
]);

type RpcTransaction = z.output<typeof sendTransactionParams>[0];

export type DecodedSendTransactionParams = Readonly<{
  from: Address.Address;
  transaction: Eip155.TransactionRequest;
  requestedChainId: bigint | undefined;
}>;

const decodeTransactionType = (request: RpcTransaction, method: string): Eip155.TransactionRequest["type"] => {
  const { type, maxFeePerGas, maxPriorityFeePerGas, accessList, gasPrice } = request;
  if (type === "0x0") return "legacy";
  if (type === "0x1") return "eip2930";
  if (type === "0x2") return "eip1559";
  if (type === "0x3") throw invalidDappParams(method, "EIP-4844 transaction type 0x3 is not supported.");
  if (type === "0x4") throw invalidDappParams(method, "EIP-7702 transaction type 0x4 is not supported.");
  if (type !== undefined) throw invalidDappParams(method, `transaction type ${type} is not supported.`);

  if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) return "eip1559";
  if (accessList !== undefined) return "eip2930";
  if (gasPrice !== undefined) return "legacy";
  return "auto";
};

export const decodeSendTransactionParams = (params: unknown, method: string): DecodedSendTransactionParams => {
  const [request] = sendTransactionParams.parse(params);
  const {
    from,
    chainId: requestedChainId,
    to,
    value,
    data,
    gas,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList,
  } = request;
  const type = decodeTransactionType(request, method);
  if (type === "eip1559" && gasPrice !== undefined) {
    throw invalidDappParams(method, "gasPrice cannot be used with an EIP-1559 transaction.");
  }
  if (type !== "eip1559" && (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined)) {
    throw invalidDappParams(method, "EIP-1559 fee fields require an EIP-1559 transaction.");
  }
  if (type === "legacy" && accessList !== undefined) {
    throw invalidDappParams(method, "accessList cannot be used with a legacy transaction.");
  }

  const common = { to, value, data, gas };
  switch (type) {
    case "auto":
      return { from, requestedChainId, transaction: { ...common, type } };
    case "legacy":
      return { from, requestedChainId, transaction: { ...common, type, gasPrice } };
    case "eip2930":
      return { from, requestedChainId, transaction: { ...common, type, gasPrice, accessList } };
    case "eip1559":
      return {
        from,
        requestedChainId,
        transaction: { ...common, type, maxFeePerGas, maxPriorityFeePerGas, accessList },
      };
  }
};
