import type { SettingsPort } from "@arx/core/services";
import { type SettingsRecord, SettingsRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { SETTINGS_ID } from "../internal/ids.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieSettingsPort implements SettingsPort {
  constructor(private readonly ctx: DexieCtx) {}

  async get(): Promise<SettingsRecord | null> {
    await this.ctx.ready;

    const row = await this.ctx.db.settings.get(SETTINGS_ID);
    if (!row) return null;

    return await parseOrDrop({
      schema: SettingsRecordSchema,
      row,
      what: "settings",
      drop: () => this.ctx.db.settings.delete(SETTINGS_ID),
      log: this.ctx.log,
    });
  }

  async put(record: SettingsRecord): Promise<void> {
    await this.ctx.ready;
    await this.ctx.db.settings.put(SettingsRecordSchema.parse(record));
  }
}
