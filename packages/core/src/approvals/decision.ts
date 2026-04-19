import { z } from "zod";
import type { ApprovalAccountSelectionDecision } from "../controllers/approval/types.js";
import { AccountKeySchema } from "../storage/records.js";

export const ApprovalAccountSelectionDecisionSchema = z
  .strictObject({
    accountKeys: z.tuple([AccountKeySchema]).rest(AccountKeySchema),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.accountKeys).size !== value.accountKeys.length) {
      ctx.addIssue({
        code: "custom",
        message: "decision.accountKeys must not contain duplicates",
        path: ["accountKeys"],
      });
    }
  }) satisfies z.ZodType<ApprovalAccountSelectionDecision>;
