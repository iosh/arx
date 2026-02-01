import { EventEmitter } from "eventemitter3";
import { type PermissionRecord, PermissionRecordSchema } from "../../db/records.js";
import type { PermissionsPort } from "./port.js";
import type { GetPermissionByOriginParams, PermissionsChangedEvent, PermissionsService } from "./types.js";

type ServiceEvents = {
  changed: PermissionsChangedEvent;
};

export type CreatePermissionsServiceOptions = {
  port: PermissionsPort;
  now?: () => number;
};

export const createPermissionsService = ({
  port,
  now = Date.now,
}: CreatePermissionsServiceOptions): PermissionsService => {
  const emitter = new EventEmitter<ServiceEvents>();

  const emitChanged = (event: PermissionsChangedEvent) => {
    emitter.emit("changed", event);
  };

  const get = async (id: PermissionRecord["id"]) => {
    const record = await port.get(id);
    return record ? PermissionRecordSchema.parse(record) : null;
  };

  const getByOrigin = async (params: GetPermissionByOriginParams) => {
    const record = await port.getByOrigin(params);
    return record ? PermissionRecordSchema.parse(record) : null;
  };

  const listAll = async () => {
    const records = await port.listAll();
    return records.map((r) => PermissionRecordSchema.parse(r));
  };
  const listByOrigin = async (origin: string) => {
    const records = await port.listByOrigin(origin);
    return records.map((r) => PermissionRecordSchema.parse(r));
  };

  const upsert = async (record: PermissionRecord) => {
    // Reuse the same id for the same (origin, namespace, chainRef) so callers can treat the record as stable.
    // This also keeps in-memory ports (and other implementations without composite uniqueness enforcement)
    // from accumulating duplicate rows.
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
    emitChanged({ origin: checked.origin });
  };

  const remove = async (id: PermissionRecord["id"]) => {
    await port.remove(id);
    // Removing by id doesn't provide the unique (origin, namespace, chainRef) key.
    // Fall back to a full resync for correctness.
    emitChanged({ origin: null });
  };
  const clearOrigin = async (origin: string) => {
    await port.clearOrigin(origin);
    emitChanged({ origin });
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
    listAll,
    listByOrigin,
    upsert,
    remove,
    clearOrigin,
  };
};
