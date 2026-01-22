import type { ChainRef } from "../chains/ids.js";
import { type OriginPermissionState, type PermissionScope, PermissionScopes } from "../controllers/permission/types.js";

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
  permissions,
  getAccounts,
}: BuildWalletPermissionsOptions): WalletPermissionDescriptor[] => {
  if (!permissions) return [];

  const descriptors: WalletPermissionDescriptor[] = [];

  for (const namespaceState of Object.values(permissions)) {
    if (!namespaceState) continue;

    const chains = namespaceState.chains.length ? unique(namespaceState.chains) : [];
    for (const scope of namespaceState.scopes) {
      const parentCapability = PERMISSION_SCOPE_CAPABILITIES[scope];
      if (!parentCapability) continue;

      const caveats: WalletPermissionCaveat[] = [];
      if (chains.length > 0) {
        caveats.push({ type: "arx:permittedChains", value: chains });
      }

      if (parentCapability === ACCOUNTS_CAPABILITY && chains.length > 0 && getAccounts) {
        const addresses = sanitizeAccounts(chains.flatMap((chainRef) => getAccounts(chainRef) ?? []));
        if (addresses.length > 0) {
          caveats.push({
            type: "restrictReturnedAccounts",
            value: unique(addresses),
          });
        }
      }

      descriptors.push(
        caveats.length > 0 ? { invoker: origin, parentCapability, caveats } : { invoker: origin, parentCapability },
      );
    }
  }

  return descriptors;
};
