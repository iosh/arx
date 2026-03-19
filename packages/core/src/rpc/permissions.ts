import { buildEip2255Permissions, type Eip2255PermissionDescriptor } from "../permissions/eip2255.js";

type ConnectionSnapshotAccountsProjection = {
  accounts: readonly { canonicalAddress: string }[];
};

export type {
  BuildEip2255PermissionsOptions,
  Eip2255PermissionCaveat,
  Eip2255PermissionDescriptor,
} from "../permissions/eip2255.js";
export { buildEip2255Permissions } from "../permissions/eip2255.js";

export const buildEip2255PermissionsFromConnectionSnapshot = (args: {
  origin: string;
  snapshot: ConnectionSnapshotAccountsProjection;
}): Eip2255PermissionDescriptor[] => {
  const { origin, snapshot } = args;

  return buildEip2255Permissions({
    origin,
    accountAddresses: snapshot.accounts.map((account) => account.canonicalAddress),
  });
};
