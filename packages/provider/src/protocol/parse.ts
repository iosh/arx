import * as z from "zod/mini";
import { DAPP_ERROR_KINDS, type PageToWalletMessage, type WalletToPageMessage } from "./messages.js";

const NON_EMPTY_STRING_SCHEMA = z.string().check(z.minLength(1));
const REQUEST_ID_SCHEMA = z.number().check(z.int(), z.nonnegative());
const JSON_VALUE_SCHEMA = z.json();
const DAPP_REQUEST_PARAMS_SCHEMA = z.union([z.array(JSON_VALUE_SCHEMA), z.record(z.string(), JSON_VALUE_SCHEMA)]);

const PROVIDER_CONNECTION_SCHEMA = z.object({
  chainRef: NON_EMPTY_STRING_SCHEMA,
  accounts: z.array(z.string()),
});

const SERIALIZED_DAPP_ERROR_SCHEMA = z.pipe(
  z.object({
    kind: z.enum(DAPP_ERROR_KINDS),
    message: NON_EMPTY_STRING_SCHEMA,
    data: z.optional(JSON_VALUE_SCHEMA),
  }),
  z.transform(({ kind, message, data }) => (data === undefined ? { kind, message } : { kind, message, data })),
);

const PAGE_TO_WALLET_MESSAGE_SCHEMA = z.pipe(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("open"),
      namespace: NON_EMPTY_STRING_SCHEMA,
    }),
    z.object({
      type: z.literal("request"),
      namespace: NON_EMPTY_STRING_SCHEMA,
      id: REQUEST_ID_SCHEMA,
      method: NON_EMPTY_STRING_SCHEMA,
      params: z.optional(DAPP_REQUEST_PARAMS_SCHEMA),
    }),
  ]),
  z.transform((message) => {
    if (message.type === "open") return message;

    const { type, namespace, id, method, params } = message;
    return params === undefined ? { type, namespace, id, method } : { type, namespace, id, method, params };
  }),
);

const WALLET_TO_PAGE_MESSAGE_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("opened"),
    namespace: NON_EMPTY_STRING_SCHEMA,
    connection: PROVIDER_CONNECTION_SCHEMA,
  }),
  z.object({
    type: z.literal("success"),
    namespace: NON_EMPTY_STRING_SCHEMA,
    id: REQUEST_ID_SCHEMA,
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("failure"),
    namespace: NON_EMPTY_STRING_SCHEMA,
    id: REQUEST_ID_SCHEMA,
    error: SERIALIZED_DAPP_ERROR_SCHEMA,
  }),
  z.object({
    type: z.literal("connection_changed"),
    namespace: NON_EMPTY_STRING_SCHEMA,
    connection: PROVIDER_CONNECTION_SCHEMA,
    changed: z.object({
      network: z.boolean(),
      accounts: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("disconnected"),
    error: SERIALIZED_DAPP_ERROR_SCHEMA,
  }),
]);

const decodeWireMessage = <Schema extends z.ZodMiniType>(schema: Schema, value: unknown): z.output<Schema> | null => {
  try {
    const decoded = z.safeParse(schema, value);
    return decoded.success ? decoded.data : null;
  } catch {
    // Recursive JSON schemas throw for cyclic or pathologically deep input.
    return null;
  }
};

export const parsePageToWalletMessage = (value: unknown): PageToWalletMessage | null => {
  return decodeWireMessage(PAGE_TO_WALLET_MESSAGE_SCHEMA, value);
};

export const parseWalletToPageMessage = (value: unknown): WalletToPageMessage | null => {
  return decodeWireMessage(WALLET_TO_PAGE_MESSAGE_SCHEMA, value);
};
