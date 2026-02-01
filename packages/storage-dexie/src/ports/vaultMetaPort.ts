import type { VaultMetaPort, VaultMetaSnapshot } from "@arx/core/storage";
import { VAULT_META_SNAPSHOT_VERSION, VaultMetaSnapshotSchema } from "@arx/core/storage";
import type { Dexie, PromiseExtended, Table } from "dexie";
import type { ArxStorageDatabase } from "../db.js";
import type { VaultMetaEntity } from "../types.js";

export class DexieVaultMetaPort implements VaultMetaPort {
  private readonly ready: PromiseExtended<Dexie>;
  private readonly table: Table<VaultMetaEntity, string>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.vaultMeta as unknown as Table<VaultMetaEntity, string>;
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    await this.ready;
    const entity = await this.table.get("vault-meta");
    if (!entity) return null;

    const parsed = VaultMetaSnapshotSchema.safeParse(entity.payload);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid vault meta detected", parsed.error);
      await this.table.delete("vault-meta");
      return null;
    }

    return parsed.data;
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    await this.ready;
    const checked = VaultMetaSnapshotSchema.parse(envelope);
    await this.table.put({
      id: "vault-meta",
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: checked.updatedAt,
      payload: checked,
    });
  }

  async clearVaultMeta(): Promise<void> {
    await this.ready;
    await this.table.delete("vault-meta");
  }
}
