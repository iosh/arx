import { EventEmitter } from "eventemitter3";
import { type PermissionRecord, PermissionRecordSchema } from "../../db/records.js";
import type { PermissionsPort } from "./port.js";
import type { GetPermissionByOriginParams, PermissionsService } from "./types.js";

type ChangedEvent = "changed";

export type CreatePermissionsServiceOptions = {
  port: PermissionsPort;
  now?: () => number;
};

export const createPermissionsService = ({
  port,
  now = Date.now,
}: CreatePermissionsServiceOptions): PermissionsService => {
  const emitter = new EventEmitter<ChangedEvent>();

  const emitChanged = () => {
    emitter.emit("changed");
  };

  const get = async (id: PermissionRecord["id"]) => {
    const record = await port.get(id);
    return record ? PermissionRecordSchema.parse(record) : null;
  };

  const getByOrigin = async (params: GetPermissionByOriginParams) => {
    const record = await port.getByOrigin(params);
    return record ? PermissionRecordSchema.parse(record) : null;
  };
  const listByOrigin = async (origin: string) => {
    const records = await port.listByOrigin(origin);
    return records.map((r) => PermissionRecordSchema.parse(r));
  };

  const upsert = async (record: PermissionRecord) => {
    // Enforce uniqueness at (origin, namespace, chainRef) even if callers supply a random id.
    const existing = await port.getByOrigin({
      origin: record.origin,
      namespace: record.namespace,
      chainRef: record.chainRef,
    });

    const checked = PermissionRecordSchema.parse({
      ...record,
      id: existing?.id ?? record.id ?? crypto.randomUUID(),
      updatedAt: now(),
    });

    await port.upsert(checked);
    emitChanged();
  };

  const remove = async (id: PermissionRecord["id"]) => {
    await port.remove(id);
    emitChanged();
  };
  const clearOrigin = async (origin: string) => {
    await port.clearOrigin(origin);
    emitChanged();
  };

  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    getByOrigin,
    listByOrigin,
    upsert,
    remove,
    clearOrigin,
  };
};
