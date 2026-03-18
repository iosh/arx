import type { ChainRef } from "../chains/ids.js";
import type { ChainPermissionAuthorization } from "../controllers/permission/types.js";
import type { AccountKey } from "../storage/records.js";
import { PermissionCapabilities, type PermissionCapability } from "./capabilities.js";

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
  authorization?: ChainPermissionAuthorization | null;
  getAccounts?: (chainRef: ChainRef, accountKeys: readonly AccountKey[]) => readonly string[] | undefined;
};

const unique = <T>(values: readonly T[]): T[] => {
  return [...new Set(values)];
};

const sanitizeAccounts = (values: readonly unknown[]): string[] => {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).map((value) => value);
};

export const buildWalletPermissions = ({
  origin,
  authorization,
  getAccounts,
}: BuildWalletPermissionsOptions): WalletPermissionDescriptor[] => {
  if (!authorization) return [];
  if (authorization.accountKeys.length === 0) {
    return [];
  }

  const addresses = sanitizeAccounts(getAccounts?.(authorization.chainRef, authorization.accountKeys) ?? []);
  const uniqueAddresses = unique(addresses);
  if (uniqueAddresses.length === 0) {
    return [];
  }

  return [
    {
      invoker: origin,
      parentCapability: PermissionCapabilities.Accounts,
      caveats: [
        {
          type: "restrictReturnedAccounts",
          value: uniqueAddresses,
        },
      ],
    },
  ];
};
