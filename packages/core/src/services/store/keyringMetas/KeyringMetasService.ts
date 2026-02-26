import { type KeyringMetaRecord, KeyringMetaRecordSchema } from "../../../storage/records.js";
import { createSignal } from "../_shared/signal.js";
import type { KeyringMetasPort } from "./port.js";
import type { KeyringMetasChangedPayload, KeyringMetasService } from "./types.js";

export type CreateKeyringMetasServiceOptions = {
  port: KeyringMetasPort;
};

export const createKeyringMetasService = ({ port }: CreateKeyringMetasServiceOptions): KeyringMetasService => {
  const changed = createSignal<KeyringMetasChangedPayload>();
  const get = async (id: KeyringMetaRecord["id"]) => {
    const record = await port.get(id);
    if (!record) return null;
    const parsed = KeyringMetaRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  const list = async () => {
    const records = await port.list();
    return records.flatMap((r) => {
      const parsed = KeyringMetaRecordSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    });
  };

  const upsert = async (record: KeyringMetaRecord) => {
    const checked = KeyringMetaRecordSchema.parse(record);
    await port.upsert(checked);
    changed.emit({ kind: "upsert", id: checked.id });
  };

  const remove = async (id: KeyringMetaRecord["id"]) => {
    await port.remove(id);
    changed.emit({ kind: "remove", id });
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    list,
    upsert,
    remove,
  };
};
