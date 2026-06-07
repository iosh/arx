import type { SettingsPort } from "@arx/core/services";
import type { SettingsRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { SETTINGS_ID } from "../internal/ids.js";

export class DexieSettingsPort implements SettingsPort {
  constructor(private readonly ctx: DexieCtx) {}

  async get(): Promise<SettingsRecord | null> {
    await this.ctx.ready;

    const row = await this.ctx.db.settings.get(SETTINGS_ID);
    return row ?? null;
  }

  async put(record: SettingsRecord): Promise<void> {
    await this.ctx.ready;
    await this.ctx.db.settings.put(record);
  }
}
