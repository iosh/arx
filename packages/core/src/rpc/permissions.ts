import { buildEip2255Permissions, type Eip2255PermissionDescriptor } from "../permissions/eip2255.js";

type AuthorizationSnapshotAccountsProjection = {
  accounts: readonly { canonicalAddress: string }[];
};

export type {
  BuildEip2255PermissionsOptions,
  Eip2255PermissionCaveat,
  Eip2255PermissionDescriptor,
} from "../permissions/eip2255.js";
export { buildEip2255Permissions } from "../permissions/eip2255.js";

export const buildEip2255PermissionsFromAuthorizationSnapshot = (args: {
  origin: string;
  snapshot: AuthorizationSnapshotAccountsProjection;
}): Eip2255PermissionDescriptor[] => {
  const { origin, snapshot } = args;

  // Adapt the generic connection projection into the EIP-2255 permission surface.
  return buildEip2255Permissions({
    origin,
    accountAddresses: snapshot.accounts.map((account) => account.canonicalAddress),
  });
};
