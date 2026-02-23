import type { ChainRef } from "../chains/ids.js";
import type { PermissionGrant } from "../controllers/permission/types.js";
import { PERMISSION_CAPABILITY_VALUES, PermissionCapabilities, type PermissionCapability } from "./capabilities.js";

export type WalletPermissionCaveat = {
  type: string;
  value: unknown;
};

export type WalletPermissionDescriptor = {
  invoker: string;
  parentCapability: PermissionCapability;
  caveats?: WalletPermissionCaveat[];
};

export type BuildWalletPermissionsOptions = {
  origin: string;
  grants?: readonly PermissionGrant[];
  getAccounts?: (chainRef: ChainRef) => readonly string[] | undefined;
};

const ACCOUNTS_CAPABILITY = PermissionCapabilities.Accounts;

// Keep helpers local to avoid re-export churn.
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
  getAccounts,
}: BuildWalletPermissionsOptions): WalletPermissionDescriptor[] => {
  const effectiveGrants: PermissionGrant[] = grants ? [...grants] : [];
  if (effectiveGrants.length === 0) return [];

  const capabilityChains = new Map<PermissionCapability, Set<ChainRef>>();
  const accountsByChain = new Map<ChainRef, string[]>();

  for (const grant of effectiveGrants) {
    if (grant.accounts) {
      accountsByChain.set(grant.chainRef, [...grant.accounts]);
    }

    for (const capability of grant.capabilities) {
      const chains = capabilityChains.get(capability) ?? new Set<ChainRef>();
      chains.add(grant.chainRef);
      capabilityChains.set(capability, chains);
    }
  }

  const descriptors: WalletPermissionDescriptor[] = [];

  for (const capability of PERMISSION_CAPABILITY_VALUES) {
    const chains = capabilityChains.get(capability);
    if (!chains || chains.size === 0) continue;

    const chainList = [...chains].sort((a, b) => a.localeCompare(b));
    const caveats: WalletPermissionCaveat[] = [{ type: "arx:permittedChains", value: chainList }];

    if (capability === ACCOUNTS_CAPABILITY) {
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

    descriptors.push({
      invoker: origin,
      parentCapability: capability,
      caveats,
    });
  }

  return descriptors;
};
