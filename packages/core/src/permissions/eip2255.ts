import { type ConnectionGrantKind, ConnectionGrantKinds } from "./connectionGrantKinds.js";

export type Eip2255PermissionCaveat = {
  type: string;
  value: unknown;
};

export type Eip2255PermissionDescriptor = {
  invoker: string;
  // EIP-2255 represents the serialized connection grant kind in `parentCapability`.
  parentCapability: ConnectionGrantKind;
  caveats?: Eip2255PermissionCaveat[];
};

export type BuildEip2255PermissionsOptions = {
  origin: string;
  accountAddresses?: readonly string[];
};

const unique = <T>(values: readonly T[]): T[] => {
  return [...new Set(values)];
};

export const buildEip2255Permissions = ({
  origin,
  accountAddresses,
}: BuildEip2255PermissionsOptions): Eip2255PermissionDescriptor[] => {
  const uniqueAddresses = unique(accountAddresses ?? []);
  if (uniqueAddresses.length === 0) {
    return [];
  }

  return [
    {
      invoker: origin,
      parentCapability: ConnectionGrantKinds.Accounts,
      caveats: [
        {
          type: "restrictReturnedAccounts",
          value: uniqueAddresses,
        },
      ],
    },
  ];
};
