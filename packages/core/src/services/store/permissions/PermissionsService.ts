import { PermissionRecordSchema } from "../../../storage/records.js";
import { createSignal } from "../_shared/signal.js";
import type { PermissionsPort } from "./port.js";
import type { PermissionKey, PermissionRecordInput, PermissionsChangedEvent, PermissionsService } from "./types.js";

export type CreatePermissionsServiceOptions = {
  port: PermissionsPort;
  now?: () => number;
};

export const createPermissionsService = ({
  port,
  now = Date.now,
}: CreatePermissionsServiceOptions): PermissionsService => {
  const changed = createSignal<PermissionsChangedEvent>();

  const PermissionRecordInputSchema = PermissionRecordSchema.omit({ updatedAt: true });

  const emitChanged = (event: PermissionsChangedEvent) => {
    changed.emit(event);
  };

  const get = async (key: PermissionKey) => {
    const record = await port.get(key);
    if (!record) return null;
    const parsed = PermissionRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  const listAll = async () => {
    const records = await port.listAll();
    return records.flatMap((r) => {
      const parsed = PermissionRecordSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    });
  };
  const listByOrigin = async (origin: string) => {
    const records = await port.listByOrigin(origin);
    return records.flatMap((r) => {
      const parsed = PermissionRecordSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    });
  };

  const upsert = async (record: PermissionRecordInput) => {
    const input = PermissionRecordInputSchema.parse(record);
    const checked = PermissionRecordSchema.parse({
      ...input,
      updatedAt: now(),
    });

    await port.upsert(checked);
    emitChanged({ origin: checked.origin });
    return checked;
  };

  const remove = async (key: PermissionKey) => {
    await port.remove(key);
    emitChanged({ origin: key.origin });
  };
  const clearOrigin = async (origin: string) => {
    await port.clearOrigin(origin);
    emitChanged({ origin });
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    listAll,
    listByOrigin,
    upsert,
    remove,
    clearOrigin,
  };
};
