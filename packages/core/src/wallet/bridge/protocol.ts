import { z } from "zod";
import { ARX_ERROR_KIND, type SerializedArxError } from "../../error.js";

export const WALLET_BRIDGE_PROTOCOL_VERSION = 1 as const;

export type WalletBridgeRequestEnvelope = {
  type: "wallet:request";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  path: string;
  input?: unknown;
};

export type WalletBridgeResponseEnvelope = {
  type: "wallet:response";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  result: unknown;
};

export type WalletBridgeErrorEnvelope = {
  type: "wallet:error";
  version: typeof WALLET_BRIDGE_PROTOCOL_VERSION;
  id: string;
  error: SerializedArxError;
};

export type WalletBridgeReplyEnvelope = WalletBridgeResponseEnvelope | WalletBridgeErrorEnvelope;
export type WalletBridgeEnvelope = WalletBridgeRequestEnvelope | WalletBridgeReplyEnvelope;

const WalletBridgeErrorSchema = z
  .object({
    kind: z.literal(ARX_ERROR_KIND),
    name: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

const WalletBridgeRequestEnvelopeSchema = z
  .object({
    type: z.literal("wallet:request"),
    version: z.literal(WALLET_BRIDGE_PROTOCOL_VERSION),
    id: z.string().min(1),
    path: z.string().min(1),
    input: z.unknown().optional(),
  })
  .strict();

const WalletBridgeResponseEnvelopeSchema = z
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
        message: "Response envelope must include result.",
      });
    }
  });

const WalletBridgeErrorEnvelopeSchema = z
  .object({
    type: z.literal("wallet:error"),
    version: z.literal(WALLET_BRIDGE_PROTOCOL_VERSION),
    id: z.string().min(1),
    error: WalletBridgeErrorSchema,
  })
  .strict();

const WalletBridgeEnvelopeSchema = z.union([
  WalletBridgeRequestEnvelopeSchema,
  WalletBridgeResponseEnvelopeSchema,
  WalletBridgeErrorEnvelopeSchema,
]);

export const parseWalletBridgeRequestEnvelope = (raw: unknown): WalletBridgeRequestEnvelope => {
  return WalletBridgeRequestEnvelopeSchema.parse(raw) as WalletBridgeRequestEnvelope;
};

export const parseWalletBridgeEnvelope = (raw: unknown): WalletBridgeEnvelope => {
  return WalletBridgeEnvelopeSchema.parse(raw) as WalletBridgeEnvelope;
};
