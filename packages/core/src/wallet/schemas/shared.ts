import { z } from "zod";

const mnemonicWordSchema = z.string().trim().min(1);

export const WalletApiSharedSchemas = {
  password: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, { message: "Password cannot be empty." }),
  mnemonicWords: z.union([z.array(mnemonicWordSchema).length(12), z.array(mnemonicWordSchema).length(24)]),
} satisfies Record<string, z.ZodTypeAny>;
