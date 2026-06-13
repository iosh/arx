import type { WalletChainSelectionPort } from "@arx/core/services";
import type { WalletChainSelectionRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { WALLET_CHAIN_SELECTION_ID } from "../internal/ids.js";

export class DexieWalletChainSelectionPort implements WalletChainSelectionPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.walletChainSelection;
  }

  async get(): Promise<WalletChainSelectionRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(WALLET_CHAIN_SELECTION_ID);
    return row ?? null;
  }

  async put(record: WalletChainSelectionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }
}
