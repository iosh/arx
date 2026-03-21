import { z } from "zod";
import { ChainRefSchema } from "../chains/ids.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols, RPC_PROTOCOLS } from "../chains/url.js";
import { AccountKeySchema } from "../storage/records.js";

const hexChainIdSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, {
  message: "Expected a 0x-prefixed hexadecimal string",
});

const httpUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, HTTP_PROTOCOLS), {
  message: "URL must use the http or https protocol",
});

const rpcUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, RPC_PROTOCOLS), {
  message: "URL must use http, https, ws, or wss protocol",
});

export const ApprovalSelectableAccountSchema = z.object({
  accountKey: AccountKeySchema,
  canonicalAddress: z.string().min(1),
  displayAddress: z.string().min(1),
});

const approvalSummaryBase = z.object({
  id: z.string().min(1),
  origin: z.string().min(1),
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  createdAt: z.number().int(),
});

export const ApprovalSummarySchema = z.discriminatedUnion("type", [
  approvalSummaryBase.extend({
    type: z.literal("requestAccounts"),
    payload: z.object({
      selectableAccounts: z.array(ApprovalSelectableAccountSchema),
      recommendedAccountKey: AccountKeySchema.nullable(),
    }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("signMessage"),
    payload: z.object({ from: z.string(), message: z.string() }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("signTypedData"),
    payload: z.object({ from: z.string(), typedData: z.string() }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("sendTransaction"),
    payload: z.object({
      from: z.string(),
      to: z.string().nullable(),
      value: z.string().optional(),
      data: z.string().optional(),
      gas: z.string().optional(),
      fee: z
        .object({
          gasPrice: z.string().optional(),
          maxFeePerGas: z.string().optional(),
          maxPriorityFeePerGas: z.string().optional(),
        })
        .optional(),
      summary: z.record(z.string(), z.unknown()).optional(),
      warnings: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            level: z.enum(["info", "warning", "error"]).optional(),
            details: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
      issues: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            severity: z.enum(["low", "medium", "high"]).optional(),
            details: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
    }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("requestPermissions"),
    payload: z.object({
      selectableAccounts: z.array(ApprovalSelectableAccountSchema),
      recommendedAccountKey: AccountKeySchema.nullable(),
      requestedGrants: z
        .array(
          z.object({
            grantKind: z.string(),
            chainRef: ChainRefSchema,
          }),
        )
        .min(1),
    }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("switchChain"),
    payload: z.object({
      chainRef: ChainRefSchema,
      chainId: hexChainIdSchema.optional(),
      displayName: z.string().min(1).optional(),
    }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("addChain"),
    payload: z.object({
      chainRef: ChainRefSchema,
      chainId: hexChainIdSchema,
      displayName: z.string().min(1),
      rpcUrls: z.array(rpcUrlSchema).min(1),
      nativeCurrency: z
        .object({
          name: z.string().min(1),
          symbol: z.string().min(1),
          decimals: z.number().int().nonnegative(),
        })
        .optional(),
      blockExplorerUrl: httpUrlSchema.optional(),
      isUpdate: z.boolean(),
    }),
  }),
  approvalSummaryBase.extend({
    type: z.literal("unsupported"),
    payload: z.object({
      rawType: z.string().min(1),
      rawPayload: z.unknown().optional(),
    }),
  }),
]);

export type ApprovalSelectableAccount = z.infer<typeof ApprovalSelectableAccountSchema>;
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;
