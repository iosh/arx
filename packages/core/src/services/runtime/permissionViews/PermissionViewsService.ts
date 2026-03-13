import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { AccountController } from "../../../controllers/account/types.js";
import type { PermissionController } from "../../../controllers/permission/types.js";
import { buildWalletPermissions as buildEip2255WalletPermissions } from "../../../permissions/eip2255.js";
import type { AccountId } from "../../../storage/records.js";
import { type UiPermissionsSnapshot, UiPermissionsSnapshotSchema } from "../../../ui/protocol/schemas.js";
import type {
  BuildWalletPermissionViewsOptions,
  ConnectionSnapshot,
  PermissionViewsService,
  PermittedAccountView,
} from "./types.js";

type CreatePermissionViewsServiceOptions = {
  accounts: Pick<AccountController, "getOwnedAccount">;
  permissions: Pick<PermissionController, "getAuthorization" | "getState">;
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
  readonly #accounts: Pick<AccountController, "getOwnedAccount">;
  readonly #permissions: Pick<PermissionController, "getAuthorization" | "getState">;

  constructor(options: CreatePermissionViewsServiceOptions) {
    this.#accounts = options.accounts;
    this.#permissions = options.permissions;
  }

  getConnectionSnapshot(origin: string, options: { chainRef: ChainRef }): ConnectionSnapshot {
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
      isConnected: isPermittedChain && accounts.length > 0,
    };
  }

  async assertConnected(origin: string, options: { chainRef: ChainRef }): Promise<void> {
    const snapshot = this.getConnectionSnapshot(origin, options);
    if (snapshot.isConnected) {
      return;
    }

    throw arxError({
      reason: ArxReasons.PermissionNotConnected,
      message: `Origin "${origin}" is not connected`,
      data: {
        origin,
        namespace: snapshot.namespace,
        chainRef: snapshot.chainRef,
      },
    });
  }

  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[] {
    return this.getConnectionSnapshot(origin, options).accounts;
  }

  buildWalletPermissions(origin: string, options: BuildWalletPermissionViewsOptions) {
    const snapshot = this.getConnectionSnapshot(origin, { chainRef: options.chainRef });

    if (options.namespace && options.namespace !== snapshot.namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Permission namespace mismatch for "${options.chainRef}"`,
        data: { chainRef: options.chainRef, namespace: options.namespace, expectedNamespace: snapshot.namespace },
      });
    }

    return buildEip2255WalletPermissions({
      origin,
      authorization: {
        origin,
        namespace: snapshot.namespace,
        chainRef: snapshot.chainRef,
        accountIds: snapshot.permittedAccountIds,
      },
      getAccounts: (chainRef) =>
        chainRef === snapshot.chainRef ? snapshot.accounts.map((account) => account.canonicalAddress) : [],
    });
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

    return UiPermissionsSnapshotSchema.parse({ origins });
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
