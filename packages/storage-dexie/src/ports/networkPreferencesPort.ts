import type { NetworkPreferencesPort } from "@arx/core/services";
import { type NetworkPreferencesRecord, NetworkPreferencesRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { NETWORK_PREFERENCES_ID } from "../internal/ids.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieNetworkPreferencesPort implements NetworkPreferencesPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.networkPreferences;
  }

  async get(): Promise<NetworkPreferencesRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(NETWORK_PREFERENCES_ID);
    if (!row) return null;

    return await parseOrDrop({
      schema: NetworkPreferencesRecordSchema,
      row,
      what: "network preferences",
      drop: () => this.table.delete(NETWORK_PREFERENCES_ID),
      log: this.ctx.log,
    });
  }

  async put(record: NetworkPreferencesRecord): Promise<void> {
    await this.ctx.ready;
    const checked = NetworkPreferencesRecordSchema.parse(record);
    await this.table.put(checked);
  }
}
