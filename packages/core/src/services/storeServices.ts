import { createAccountsService } from "./accounts/AccountsService.js";
import type { AccountsPort } from "./accounts/port.js";
import { createApprovalsService } from "./approvals/ApprovalsService.js";
import type { ApprovalsPort } from "./approvals/port.js";
import { createKeyringMetasService } from "./keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "./keyringMetas/port.js";
import { createPermissionsService } from "./permissions/PermissionsService.js";
import type { PermissionsPort } from "./permissions/port.js";
import type { TransactionsPort } from "./transactions/port.js";
import { createTransactionsService } from "./transactions/TransactionsService.js";

export type CreateStoreServicesOptions = {
  now?: () => number;

  ports: {
    approvals: ApprovalsPort;
    permissions: PermissionsPort;
    accounts: AccountsPort;
    keyringMetas: KeyringMetasPort;
    transactions: TransactionsPort;
  };
};

export const createStoreServices = ({ ports, now }: CreateStoreServicesOptions) => {
  const clock = now ?? Date.now;

  const approvals = createApprovalsService({ port: ports.approvals, now: clock });
  const permissions = createPermissionsService({ port: ports.permissions, now: clock });
  const accounts = createAccountsService({ port: ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: ports.keyringMetas });
  const transactions = createTransactionsService({ port: ports.transactions, now: clock });

  return { approvals, permissions, accounts, keyringMetas, transactions };
};
