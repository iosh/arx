import type { NetworkSelectionPort } from "@arx/core/services";
import { type NetworkSelectionRecord, NetworkSelectionRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { NETWORK_SELECTION_ID } from "../internal/ids.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieNetworkSelectionPort implements NetworkSelectionPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.networkSelection;
  }

  async get(): Promise<NetworkSelectionRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(NETWORK_SELECTION_ID);
    if (!row) return null;

    return await parseOrDrop({
      schema: NetworkSelectionRecordSchema,
      row,
      what: "network selection",
      drop: () => this.table.delete(NETWORK_SELECTION_ID),
      log: this.ctx.log,
    });
  }

  async put(record: NetworkSelectionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(NetworkSelectionRecordSchema.parse(record));
  }
}
