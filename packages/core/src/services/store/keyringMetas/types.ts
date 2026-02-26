import type { KeyringMetaRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type KeyringMetasChangedPayload =
  | { kind: "upsert"; id: KeyringMetaRecord["id"] }
  | { kind: "remove"; id: KeyringMetaRecord["id"] };

export type KeyringMetasService = {
  subscribeChanged(handler: (payload: KeyringMetasChangedPayload) => void): Unsubscribe;

  get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null>;
  list(): Promise<KeyringMetaRecord[]>;

  upsert(record: KeyringMetaRecord): Promise<void>;
  remove(id: KeyringMetaRecord["id"]): Promise<void>;
};
