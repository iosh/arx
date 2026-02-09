import { accountsMethods } from "./methods/accounts.js";
import { approvalsMethods } from "./methods/approvals.js";
import { attentionMethods } from "./methods/attention.js";
import { balancesMethods } from "./methods/balances.js";
import { keyringsMethods } from "./methods/keyrings.js";
import { networksMethods } from "./methods/networks.js";
import { onboardingMethods } from "./methods/onboarding.js";
import { sessionMethods } from "./methods/session.js";
import { snapshotMethods } from "./methods/snapshot.js";
import { transactionsMethods } from "./methods/transactions.js";
import type { UiMethodDefinition } from "./methods/types.js";

export const uiMethods = {
  // --- snapshot ---
  ...snapshotMethods,

  // --- attention ---
  ...attentionMethods,

  // --- balances ---
  ...balancesMethods,

  // --- session ---
  ...sessionMethods,

  // --- onboarding ---
  ...onboardingMethods,

  // --- accounts ---
  ...accountsMethods,

  // --- networks ---
  ...networksMethods,

  // --- approvals ---
  ...approvalsMethods,

  // --- keyrings ---
  ...keyringsMethods,

  // --- transactions ---
  ...transactionsMethods,
} as const satisfies Record<string, UiMethodDefinition>;
