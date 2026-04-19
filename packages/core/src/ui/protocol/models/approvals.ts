import { z } from "zod";
import { ApprovalAccountSelectionDecisionSchema } from "../../../approvals/decision.js";
import { ChainRefSchema } from "../../../chains/ids.js";
import { type ApprovalKind, ApprovalKinds } from "../../../controllers/approval/types.js";
import {
  type SendTransactionApprovalReview,
  SendTransactionApprovalReviewSchema,
} from "../../../controllers/transaction/review/types.js";
import { AccountKeySchema } from "../../../storage/records.js";

const APPROVAL_KIND_VALUES = [
  ApprovalKinds.RequestAccounts,
  ApprovalKinds.RequestPermissions,
  ApprovalKinds.SignMessage,
  ApprovalKinds.SignTypedData,
  ApprovalKinds.SendTransaction,
  ApprovalKinds.SwitchChain,
  ApprovalKinds.AddChain,
] as const satisfies readonly [ApprovalKind, ...ApprovalKind[]];

const ApprovalKindSchema = z.enum(APPROVAL_KIND_VALUES);

export const ApprovalSelectableAccountSchema = z.strictObject({
  accountKey: AccountKeySchema,
  canonicalAddress: z.string().min(1),
  displayAddress: z.string().min(1),
});

export const ApprovalListEntrySchema = z.strictObject({
  approvalId: z.string().min(1),
  kind: ApprovalKindSchema,
  origin: z.string().min(1),
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  createdAt: z.number().int(),
});

const ApprovalDetailBaseSchema = z.strictObject({
  approvalId: z.string().min(1),
  kind: ApprovalKindSchema,
  origin: z.string().min(1),
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  createdAt: z.number().int(),
  actions: z.strictObject({
    canApprove: z.boolean(),
    canReject: z.boolean(),
  }),
});

const RequestAccountsRequestSchema = z.strictObject({
  selectableAccounts: z.array(ApprovalSelectableAccountSchema),
  recommendedAccountKey: AccountKeySchema.nullable(),
});

const RequestPermissionsRequestSchema = z.strictObject({
  selectableAccounts: z.array(ApprovalSelectableAccountSchema),
  recommendedAccountKey: AccountKeySchema.nullable(),
  requestedGrants: z
    .array(
      z.strictObject({
        grantKind: z.string().min(1),
        chainRef: ChainRefSchema,
      }),
    )
    .min(1),
});

const SignMessageRequestSchema = z.strictObject({
  from: z.string().min(1),
  message: z.string().min(1),
});

const SignTypedDataRequestSchema = z.strictObject({
  from: z.string().min(1),
  typedData: z.string().min(1),
});

const SwitchChainRequestSchema = z.strictObject({
  chainRef: ChainRefSchema,
  chainId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  displayName: z.string().min(1).optional(),
});

const AddChainRequestSchema = z.strictObject({
  chainRef: ChainRefSchema,
  chainId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  displayName: z.string().min(1),
  rpcUrls: z.array(z.url()).min(1),
  nativeCurrency: z
    .strictObject({
      name: z.string().min(1),
      symbol: z.string().min(1),
      decimals: z.number().int().nonnegative(),
    })
    .optional(),
  blockExplorerUrl: z.url().optional(),
  isUpdate: z.boolean(),
});

const SendTransactionRequestSchema = z.strictObject({
  transactionId: z.string().min(1),
  chainRef: ChainRefSchema,
  origin: z.string().min(1),
});

export const ApprovalAccountSelectionDetailSchema = z.discriminatedUnion("kind", [
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.RequestAccounts),
    request: RequestAccountsRequestSchema,
    review: z.null(),
  }),
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.RequestPermissions),
    request: RequestPermissionsRequestSchema,
    review: z.null(),
  }),
]);

export const ApprovalStaticDetailSchema = z.discriminatedUnion("kind", [
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.SignMessage),
    request: SignMessageRequestSchema,
    review: z.null(),
  }),
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.SignTypedData),
    request: SignTypedDataRequestSchema,
    review: z.null(),
  }),
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.SwitchChain),
    request: SwitchChainRequestSchema,
    review: z.null(),
  }),
  ApprovalDetailBaseSchema.extend({
    kind: z.literal(ApprovalKinds.AddChain),
    request: AddChainRequestSchema,
    review: z.null(),
  }),
]);

export const ApprovalSendTransactionDetailSchema = ApprovalDetailBaseSchema.extend({
  kind: z.literal(ApprovalKinds.SendTransaction),
  request: SendTransactionRequestSchema,
  review: SendTransactionApprovalReviewSchema,
});

export const ApprovalDetailSchema = z.discriminatedUnion("kind", [
  ...ApprovalAccountSelectionDetailSchema.options,
  ...ApprovalStaticDetailSchema.options,
  ApprovalSendTransactionDetailSchema,
]);

export const ApprovalResolveRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("approve"),
    decision: ApprovalAccountSelectionDecisionSchema.optional(),
  }),
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("reject"),
    reason: z.string().min(1).optional(),
  }),
]);

export const ApprovalResolveResultSchema = z.null();

export type ApprovalListEntry = z.infer<typeof ApprovalListEntrySchema>;
export type ApprovalSelectableAccount = z.infer<typeof ApprovalSelectableAccountSchema>;
export type ApprovalDetail = z.infer<typeof ApprovalDetailSchema>;
export type ApprovalAccountSelectionDetail = z.infer<typeof ApprovalAccountSelectionDetailSchema>;
export type ApprovalStaticDetail = z.infer<typeof ApprovalStaticDetailSchema>;
export type ApprovalSendTransactionDetail = z.infer<typeof ApprovalSendTransactionDetailSchema>;
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequestSchema>;
export type ApprovalResolveResult = z.infer<typeof ApprovalResolveResultSchema>;
export type { SendTransactionApprovalReview };
