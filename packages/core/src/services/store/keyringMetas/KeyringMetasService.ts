import type { KeyringMetaRecord } from "../../../storage/records.js";
import { createSignal } from "../_shared/signal.js";
import type { KeyringMetasPort } from "./port.js";
import type { KeyringMetasChangedPayload, KeyringMetasService } from "./types.js";

export type CreateKeyringMetasServiceOptions = {
  port: KeyringMetasPort;
};

export const createKeyringMetasService = ({ port }: CreateKeyringMetasServiceOptions): KeyringMetasService => {
  const changed = createSignal<KeyringMetasChangedPayload>();
  const get = async (id: KeyringMetaRecord["id"]) => {
    return await port.get(id);
  };

  const list = async () => {
    return await port.list();
  };

  const upsert = async (record: KeyringMetaRecord) => {
    await port.upsert(record);
    changed.emit({ kind: "upsert", id: record.id });
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
