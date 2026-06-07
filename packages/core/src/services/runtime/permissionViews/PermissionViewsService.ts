import type { AccountSelectionService } from "../../../accounts/runtime/types.js";
import { parseChainRef } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import { PermissionNotConnectedError } from "../../../permissions/errors.js";
import type { PermissionsReader } from "../../../permissions/service/types.js";
import type { AccountKey } from "../../../storage/records.js";
import type { UiPermissionsSnapshot } from "../../../ui/protocol/schemas.js";
import type { AuthorizationSnapshot, PermissionViewsService, PermittedAccountView } from "./types.js";

type CreatePermissionViewsServiceOptions = {
  accounts: Pick<AccountSelectionService, "getOwnedAccount">;
  permissions: Pick<PermissionsReader, "getAuthorization" | "getState">;
};

const sortChainRefs = (values: readonly ChainRef[]): ChainRef[] => {
  return [...values].sort((left, right) => left.localeCompare(right));
};

const uniqAccountKeys = (values: readonly AccountKey[]): AccountKey[] => {
  const seen = new Set<AccountKey>();
  const next: AccountKey[] = [];

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
    const rawAccountKeys = authorization?.chains[chainRef]?.accountKeys ?? [];
    const accounts = this.#resolveAccounts(namespace, chainRef, rawAccountKeys);
    const permittedAccountKeys = accounts.map((account) => account.accountKey);
    const isPermittedChain = permittedChainRefs.includes(chainRef);

    return {
      namespace,
      chainRef,
      isPermittedChain,
      permittedChainRefs,
      permittedAccountKeys,
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

  buildUiPermissionsSnapshot(): UiPermissionsSnapshot {
    const state = this.#permissions.getState();
    const origins: UiPermissionsSnapshot["origins"] = {};

    for (const origin of Object.keys(state.origins).sort((left, right) => left.localeCompare(right))) {
      const originState = state.origins[origin];
      if (!originState) {
        continue;
      }

      const namespaces: UiPermissionsSnapshot["origins"][string] = {};
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
                accountKeys: this.#resolveAccounts(
                  namespace,
                  chainRef,
                  namespaceState.chains[chainRef]?.accountKeys ?? [],
                ).map((account) => account.accountKey),
              },
            ]),
          ),
        };
      }

      origins[origin] = namespaces;
    }

    return { origins };
  }

  #resolveAccounts(namespace: string, chainRef: ChainRef, accountKeys: readonly AccountKey[]): PermittedAccountView[] {
    const accounts: PermittedAccountView[] = [];

    for (const accountKey of uniqAccountKeys(accountKeys)) {
      try {
        const account = this.#accounts.getOwnedAccount({ namespace, chainRef, accountKey });
        if (!account) {
          continue;
        }
        accounts.push({
          accountKey: account.accountKey,
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
