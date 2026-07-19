import type { Accounts } from "../../accounts/Accounts.js";
import type { AccountId } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { parseChainRef } from "../../networks/chainRef.js";
import { PermissionNotConnectedError } from "../errors.js";
import type { PermissionsReader } from "../service/types.js";
import type {
  AuthorizationSnapshot,
  PermissionsSnapshot,
  PermissionViewsService,
  PermittedAccountView,
} from "./types.js";

type CreatePermissionViewsServiceOptions = {
  accounts: Pick<Accounts, "getAccount" | "getAddress">;
  permissions: Pick<PermissionsReader, "getAuthorization" | "getState">;
};

const sortChainRefs = (values: readonly ChainRef[]): ChainRef[] => {
  return [...values].sort((left, right) => left.localeCompare(right));
};

const uniqAccountIds = (values: readonly AccountId[]): AccountId[] => {
  const seen = new Set<AccountId>();
  const next: AccountId[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }

  return next;
};

class DefaultPermissionViewsService implements PermissionViewsService {
  readonly #accounts: Pick<Accounts, "getAccount" | "getAddress">;
  readonly #permissions: Pick<PermissionsReader, "getAuthorization" | "getState">;

  constructor(options: CreatePermissionViewsServiceOptions) {
    this.#accounts = options.accounts;
    this.#permissions = options.permissions;
  }

  getAuthorizationSnapshot(origin: string, options: { chainRef: ChainRef }): AuthorizationSnapshot {
    const { chainRef } = options;
    const { namespace } = parseChainRef(chainRef);
    const authorization = this.#permissions.getAuthorization(origin, { namespace });
    const permittedChainRefs = sortChainRefs(Object.keys(authorization?.chains ?? {}) as ChainRef[]);
    const rawAccountIds = authorization?.chains[chainRef]?.accountIds ?? [];
    const accounts = this.#resolveAccounts(chainRef, rawAccountIds);
    const permittedAccountIds = accounts.map((account) => account.accountId);
    const isPermittedChain = permittedChainRefs.includes(chainRef);

    return {
      namespace,
      chainRef,
      isPermittedChain,
      permittedChainRefs,
      permittedAccountIds,
      accounts,
      isAuthorized: isPermittedChain && accounts.length > 0,
    };
  }

  async assertAuthorized(origin: string, options: { chainRef: ChainRef }): Promise<void> {
    const snapshot = this.getAuthorizationSnapshot(origin, options);
    if (snapshot.isAuthorized) {
      return;
    }

    throw new PermissionNotConnectedError();
  }

  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[] {
    return this.getAuthorizationSnapshot(origin, options).accounts;
  }

  buildPermissionsSnapshot(): PermissionsSnapshot {
    const state = this.#permissions.getState();
    const origins: PermissionsSnapshot["origins"] = {};

    for (const origin of Object.keys(state.origins).sort((left, right) => left.localeCompare(right))) {
      const originState = state.origins[origin];
      if (!originState) {
        continue;
      }

      const namespaces: PermissionsSnapshot["origins"][string] = {};
      for (const namespace of Object.keys(originState).sort((left, right) => left.localeCompare(right))) {
        const namespaceState = originState[namespace];
        if (!namespaceState) {
          continue;
        }

        namespaces[namespace] = {
          chains: Object.fromEntries(
            sortChainRefs(Object.keys(namespaceState.chains) as ChainRef[]).map((chainRef) => [
              chainRef,
              {
                accountIds: this.#resolveAccounts(chainRef, namespaceState.chains[chainRef]?.accountIds ?? []).map(
                  (account) => account.accountId,
                ),
              },
            ]),
          ),
        };
      }

      origins[origin] = namespaces;
    }

    return { origins };
  }

  #resolveAccounts(chainRef: ChainRef, accountIds: readonly AccountId[]): PermittedAccountView[] {
    const accounts: PermittedAccountView[] = [];

    for (const accountId of uniqAccountIds(accountIds)) {
      const account = this.#accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      if (account.hidden) continue;

      const address = this.#accounts.getAddress({ chainRef, accountId });
      accounts.push({
        accountId: address.accountId,
        canonicalAddress: address.canonicalAddress,
        displayAddress: address.displayAddress,
      });
    }

    return accounts;
  }
}

export const createPermissionViewsService = (options: CreatePermissionViewsServiceOptions): PermissionViewsService => {
  return new DefaultPermissionViewsService(options);
};
