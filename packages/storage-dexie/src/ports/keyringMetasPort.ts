import type { KeyringMetasPort } from "@arx/core/services";
import type { KeyringMetaRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
export class DexieKeyringMetasPort implements KeyringMetasPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.keyringMetas;
  }

  async get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(id);
    return row ?? null;
  }

  async list(): Promise<KeyringMetaRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: KeyringMetaRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }
  async remove(id: KeyringMetaRecord["id"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(id);
  }
}
