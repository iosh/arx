import { z } from "zod";
import { ApprovalAccountSelectionDecisionSchema } from "../../approvals/decision.js";

const ApprovalDetailInputSchema = z.strictObject({
  approvalId: z.string().min(1),
});

export const ApprovalResolveInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("approve"),
    decision: ApprovalAccountSelectionDecisionSchema.optional(),
    expectedPrepareId: z.string().min(1).optional(),
  }),
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("reject"),
    reason: z.string().min(1).optional(),
  }),
]);

export const WalletApiApprovalsSchemas = {
  getDetail: ApprovalDetailInputSchema,
  resolve: ApprovalResolveInputSchema,
} satisfies Record<string, z.ZodTypeAny>;
