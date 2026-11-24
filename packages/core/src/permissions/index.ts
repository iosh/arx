export * from "./bootstrap.js";
export {
  type CreateDappAuthorizationOptions,
  createDappAuthorization,
  type DappAuthorization,
  type PermissionsApi,
} from "./createDappAuthorization.js";
export * from "./errors.js";
export type { Permission, PermissionsChanged, PermissionsReader } from "./Permissions.js";
export { Permissions } from "./Permissions.js";
export type { PermissionRecord, PermissionRecordsReader } from "./persistence.js";
export type { DappScope } from "./scope.js";
