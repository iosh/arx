import type { ChainRef } from "../chains/ids.js";
import {
  type OriginPermissionState,
  type PermissionGrant,
  type PermissionScope,
  PermissionScopes,
} from "../controllers/permission/types.js";

export type WalletPermissionCaveat = {
  type: string;
  value: unknown;
};

export type WalletPermissionDescriptor = {
  invoker: string;
  parentCapability: string;
  caveats?: WalletPermissionCaveat[];
};

export type BuildWalletPermissionsOptions = {
  origin: string;
  grants?: readonly PermissionGrant[];
  permissions?: OriginPermissionState;
  getAccounts?: (chainRef: ChainRef) => readonly string[] | undefined;
};

// Map internal scopes to the EIP-2255 capability strings dApps expect.
export const PERMISSION_SCOPE_CAPABILITIES: Record<PermissionScope, string> = {
  [PermissionScopes.Basic]: "wallet_basic",
  [PermissionScopes.Accounts]: "eth_accounts",
  [PermissionScopes.Sign]: "wallet_sign",
  [PermissionScopes.Transaction]: "wallet_sendTransaction",
};

const ACCOUNTS_CAPABILITY = PERMISSION_SCOPE_CAPABILITIES[PermissionScopes.Accounts];

const SCOPE_ORDER: readonly PermissionScope[] = [
  PermissionScopes.Basic,
  PermissionScopes.Accounts,
  PermissionScopes.Sign,
  PermissionScopes.Transaction,
];

// Keep simple helpers local to avoid re-export churn.
const unique = <T>(values: readonly T[]): T[] => {
  return [...new Set(values)];
};

// Drop non-string values so a faulty getAccounts implementation cannot corrupt caveats.
const sanitizeAccounts = (values: readonly unknown[]): string[] => {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).map((value) => value);
};

export const buildWalletPermissions = ({
  origin,
  grants,
  permissions,
  getAccounts,
}: BuildWalletPermissionsOptions): WalletPermissionDescriptor[] => {
  const effectiveGrants: PermissionGrant[] =
    (grants ? [...grants] : undefined) ??
    (permissions
      ? Object.entries(permissions).flatMap(([namespace, namespaceState]) =>
          unique(namespaceState.chains).map((chainRef) => ({
            origin,
            namespace: namespace as PermissionGrant["namespace"],
            chainRef,
            scopes: [...namespaceState.scopes],
          })),
        )
      : []);

  if (effectiveGrants.length === 0) return [];

  const scopeChains = new Map<PermissionScope, Set<ChainRef>>();
  const accountsByChain = new Map<ChainRef, string[]>();

  for (const grant of effectiveGrants) {
    if (grant.accounts) {
      accountsByChain.set(grant.chainRef, [...grant.accounts]);
    }

    for (const scope of grant.scopes) {
      const chains = scopeChains.get(scope) ?? new Set<ChainRef>();
      chains.add(grant.chainRef);
      scopeChains.set(scope, chains);
    }
  }

  const descriptors: WalletPermissionDescriptor[] = [];

  for (const scope of SCOPE_ORDER) {
    const chains = scopeChains.get(scope);
    if (!chains || chains.size === 0) continue;

    const parentCapability = PERMISSION_SCOPE_CAPABILITIES[scope];
    if (!parentCapability) continue;

    const chainList = [...chains].sort((a, b) => a.localeCompare(b));

    const caveats: WalletPermissionCaveat[] = [{ type: "arx:permittedChains", value: chainList }];

    if (parentCapability === ACCOUNTS_CAPABILITY) {
      const addresses = sanitizeAccounts(
        chainList.flatMap((chainRef) => {
          if (getAccounts) return getAccounts(chainRef) ?? [];
          return accountsByChain.get(chainRef) ?? [];
        }),
      );

      const uniqueAddresses = unique(addresses);
      if (uniqueAddresses.length > 0) {
        caveats.push({
          type: "restrictReturnedAccounts",
          value: uniqueAddresses,
        });
      }
    }

    descriptors.push({ invoker: origin, parentCapability, caveats });
  }

  return descriptors;
};
