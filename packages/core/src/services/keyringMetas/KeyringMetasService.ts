import { EventEmitter } from "eventemitter3";
import { type KeyringMetaRecord, KeyringMetaRecordSchema } from "../../db/records.js";
import type { KeyringMetasPort } from "./port.js";
import type { KeyringMetasService } from "./types.js";

type ChangedEvent = "changed";

export type CreateKeyringMetasServiceOptions = {
  port: KeyringMetasPort;
};

export const createKeyringMetasService = ({ port }: CreateKeyringMetasServiceOptions): KeyringMetasService => {
  const emitter = new EventEmitter<ChangedEvent>();
  const emitChanged = () => {
    emitter.emit("changed");
  };
  const get = async (id: KeyringMetaRecord["id"]) => {
    const record = await port.get(id);
    return record ? KeyringMetaRecordSchema.parse(record) : null;
  };

  const list = async () => {
    const records = await port.list();
    return records.map((r) => KeyringMetaRecordSchema.parse(r));
  };

  const upsert = async (record: KeyringMetaRecord) => {
    const checked = KeyringMetaRecordSchema.parse(record);
    await port.upsert(checked);
    emitChanged();
  };

  const remove = async (id: KeyringMetaRecord["id"]) => {
    await port.remove(id);
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
    list,
    upsert,
    remove,
  };
};
