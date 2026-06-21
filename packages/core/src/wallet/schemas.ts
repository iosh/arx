import type { z } from "zod";
import { WalletApiAccountsSchemas } from "./schemas/accounts.js";
import { ApprovalResolveInputSchema, WalletApiApprovalsSchemas } from "./schemas/approvals.js";
import { WalletApiBalancesSchemas } from "./schemas/balances.js";
import { WalletApiChainsSchemas } from "./schemas/chains.js";
import { WalletApiKeyringsSchemas } from "./schemas/keyrings.js";
import { WalletApiOnboardingSchemas } from "./schemas/onboarding.js";
import { WalletApiSessionSchemas } from "./schemas/session.js";
import { WalletApiSharedSchemas } from "./schemas/shared.js";
import {
  WalletApiEip155TransactionDraftChangeSchema,
  WalletApiNamespaceTransactionDraftEditSchema,
  WalletApiTransactionsSchemas,
} from "./schemas/transactions.js";

export const WalletApiSchemas = {
  session: WalletApiSessionSchemas,
  onboarding: WalletApiOnboardingSchemas,
  accounts: WalletApiAccountsSchemas,
  balances: WalletApiBalancesSchemas,
  chains: WalletApiChainsSchemas,
  approvals: WalletApiApprovalsSchemas,
  keyrings: WalletApiKeyringsSchemas,
  transactions: WalletApiTransactionsSchemas,
} satisfies Record<string, Record<string, z.ZodTypeAny>>;

export {
  ApprovalResolveInputSchema,
  WalletApiAccountsSchemas,
  WalletApiApprovalsSchemas,
  WalletApiBalancesSchemas,
  WalletApiChainsSchemas,
  WalletApiEip155TransactionDraftChangeSchema,
  WalletApiKeyringsSchemas,
  WalletApiNamespaceTransactionDraftEditSchema,
  WalletApiOnboardingSchemas,
  WalletApiSessionSchemas,
  WalletApiSharedSchemas,
  WalletApiTransactionsSchemas,
};
