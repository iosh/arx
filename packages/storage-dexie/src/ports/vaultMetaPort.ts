import { VAULT_META_SNAPSHOT_VERSION, type VaultMetaPort, type VaultMetaSnapshot } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { VAULT_META_ID } from "../internal/ids.js";
import type { VaultMetaEntity } from "../types.js";

export class DexieVaultMetaPort implements VaultMetaPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.vaultMeta;
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    await this.ctx.ready;

    const entity = (await this.table.get(VAULT_META_ID)) as VaultMetaEntity | undefined;
    return entity?.payload ?? null;
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    await this.ctx.ready;

    await this.table.put({
      id: VAULT_META_ID,
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: envelope.updatedAt,
      payload: envelope,
    });
  }

  async clearVaultMeta(): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(VAULT_META_ID);
  }
}
