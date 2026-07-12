import type { AccountSelectionService } from "../../accounts/selection/types.js";
import { parseChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../storage/records.js";
import { PermissionNotConnectedError } from "../errors.js";
import type { PermissionsReader } from "../service/types.js";
import type {
  AuthorizationSnapshot,
  PermissionsSnapshot,
  PermissionViewsService,
  PermittedAccountView,
} from "./types.js";

type CreatePermissionViewsServiceOptions = {
  accounts: Pick<AccountSelectionService, "getOwnedAccount">;
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
  readonly #accounts: Pick<AccountSelectionService, "getOwnedAccount">;
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
    const accounts = this.#resolveAccounts(namespace, chainRef, rawAccountIds);
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
                accountIds: this.#resolveAccounts(
                  namespace,
                  chainRef,
                  namespaceState.chains[chainRef]?.accountIds ?? [],
                ).map((account) => account.accountId),
              },
            ]),
          ),
        };
      }

      origins[origin] = namespaces;
    }

    return { origins };
  }

  #resolveAccounts(namespace: string, chainRef: ChainRef, accountIds: readonly AccountId[]): PermittedAccountView[] {
    const accounts: PermittedAccountView[] = [];

    for (const accountId of uniqAccountIds(accountIds)) {
      try {
        const account = this.#accounts.getOwnedAccount({ namespace, chainRef, accountId });
        if (!account) {
          continue;
        }
        accounts.push({
          accountId: account.accountId,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        });
      } catch {
        // Ignore stale or invalid account references and keep projecting the remaining record.
      }
    }

    return accounts;
  }
}

export const createPermissionViewsService = (options: CreatePermissionViewsServiceOptions): PermissionViewsService => {
  return new DefaultPermissionViewsService(options);
};
