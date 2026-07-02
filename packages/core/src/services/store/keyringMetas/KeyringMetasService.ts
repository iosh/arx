import type { Messenger } from "../../../messenger/index.js";
import type { KeyringMetaRecord } from "../../../storage/records.js";
import type { KeyringMetasPort } from "./port.js";
import { KEYRING_METAS_STORE_CHANGED } from "./topics.js";
import type { KeyringMetasService } from "./types.js";

export type CreateKeyringMetasServiceOptions = {
  messenger: Messenger;
  port: KeyringMetasPort;
};

const areKeyringMetaRecordsEqual = (left: KeyringMetaRecord, right: KeyringMetaRecord): boolean =>
  left.id === right.id &&
  left.type === right.type &&
  left.alias === right.alias &&
  left.needsBackup === right.needsBackup &&
  left.nextDerivationIndex === right.nextDerivationIndex &&
  left.createdAt === right.createdAt;

export const createKeyringMetasService = ({
  messenger,
  port,
}: CreateKeyringMetasServiceOptions): KeyringMetasService => {
  const get = async (id: KeyringMetaRecord["id"]) => {
    return await port.get(id);
  };

  const list = async () => {
    return await port.list();
  };

  const upsert = async (record: KeyringMetaRecord) => {
    const existing = await port.get(record.id);
    if (existing && areKeyringMetaRecordsEqual(existing, record)) {
      return;
    }

    await port.upsert(record);
    messenger.publish(KEYRING_METAS_STORE_CHANGED, { kind: "upsert", id: record.id });
  };

  const remove = async (id: KeyringMetaRecord["id"]) => {
    const existing = await port.get(id);
    if (!existing) {
      return;
    }

    await port.remove(id);
    messenger.publish(KEYRING_METAS_STORE_CHANGED, { kind: "remove", id });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(KEYRING_METAS_STORE_CHANGED, handler),

    get,
    list,
    upsert,
    remove,
  };
};
