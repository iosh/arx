import { z } from "zod";
import { ARX_ERROR_KIND, type SerializedArxError } from "../../error.js";

export const WALLET_BRIDGE_PROTOCOL_VERSION = 1 as const;

export type WalletBridgeRequest = {
  type: "wallet:request";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  path: string;
  input?: unknown;
};

export type WalletBridgeResponse = {
  type: "wallet:response";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  result: unknown;
};

export type WalletBridgeError = {
  type: "wallet:error";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  error: SerializedArxError;
};

export type WalletBridgeReply = WalletBridgeResponse | WalletBridgeError;
type WalletBridgeRequestMessageCandidate = Pick<WalletBridgeRequest, "type">;
type WalletBridgeReplyMessageCandidate = Pick<WalletBridgeReply, "type">;

const SerializedWalletBridgeErrorSchema = z
  .object({
    kind: z.literal(ARX_ERROR_KIND),
    name: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

const WalletBridgeRequestSchema = z
  .object({
    type: z.literal("wallet:request"),
    version: z.literal(WALLET_BRIDGE_PROTOCOL_VERSION),
    id: z.string().min(1),
    path: z.string().min(1),
    input: z.unknown().optional(),
  })
  .strict();

const WalletBridgeResponseSchema = z
  .object({
    type: z.literal("wallet:response"),
    version: z.literal(WALLET_BRIDGE_PROTOCOL_VERSION),
    id: z.string().min(1),
    result: z.unknown(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!Object.hasOwn(value, "result")) {
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: "Response message must include result.",
      });
    }
  });

const WalletBridgeErrorMessageSchema = z
  .object({
    type: z.literal("wallet:error"),
    version: z.literal(WALLET_BRIDGE_PROTOCOL_VERSION),
    id: z.string().min(1),
    error: SerializedWalletBridgeErrorSchema,
  })
  .strict();

const WalletBridgeReplySchema = z.union([WalletBridgeResponseSchema, WalletBridgeErrorMessageSchema]);

export const parseWalletBridgeRequest = (raw: unknown): WalletBridgeRequest => {
  return WalletBridgeRequestSchema.parse(raw) as WalletBridgeRequest;
};

export const parseWalletBridgeReply = (raw: unknown): WalletBridgeReply => {
  return WalletBridgeReplySchema.parse(raw) as WalletBridgeReply;
};

export const isWalletBridgeRequestMessage = (raw: unknown): raw is WalletBridgeRequestMessageCandidate => {
  const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
  return type === "wallet:request";
};

export const isWalletBridgeReplyMessage = (raw: unknown): raw is WalletBridgeReplyMessageCandidate => {
  const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
  return type === "wallet:response" || type === "wallet:error";
};
