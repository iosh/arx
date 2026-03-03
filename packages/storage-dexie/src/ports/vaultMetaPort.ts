import type { VaultMetaPort, VaultMetaSnapshot } from "@arx/core/storage";
import { VAULT_META_SNAPSHOT_VERSION, VaultMetaSnapshotSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { VAULT_META_ID } from "../internal/ids.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";
import type { VaultMetaEntity } from "../types.js";

export class DexieVaultMetaPort implements VaultMetaPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.vaultMeta;
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    await this.ctx.ready;

    const entity = (await this.table.get(VAULT_META_ID)) as VaultMetaEntity | undefined;
    if (!entity) return null;

    return await parseOrDrop({
      schema: VaultMetaSnapshotSchema,
      row: entity.payload,
      what: "vault meta",
      drop: () => this.table.delete(VAULT_META_ID),
      log: this.ctx.log,
    });
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    await this.ctx.ready;

    const checked = VaultMetaSnapshotSchema.parse(envelope);
    await this.table.put({
      id: VAULT_META_ID,
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: checked.updatedAt,
      payload: checked,
    });
  }

  async clearVaultMeta(): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(VAULT_META_ID);
  }
}
