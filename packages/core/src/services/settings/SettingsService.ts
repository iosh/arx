import { EventEmitter } from "eventemitter3";

import type { ChainRef } from "../../chains/ids.js";
import { type SettingsRecord, SettingsRecordSchema } from "../../db/records.js";
import type { SettingsPort } from "./port.js";
import type { SettingsService, UpdateSettingsParams } from "./types.js";

type ChangedEvent = "changed";

export type CreateSettingsServiceOptions = {
  port: SettingsPort;
  defaults: {
    activeChainRef: ChainRef;
  };
  now?: () => number;
};

export const createSettingsService = ({ port, defaults, now }: CreateSettingsServiceOptions): SettingsService => {
  const emitter = new EventEmitter<ChangedEvent>();
  const clock = now ?? Date.now;

  let writeQueue: Promise<SettingsRecord> = Promise.resolve(
    SettingsRecordSchema.parse({ id: "settings", activeChainRef: defaults.activeChainRef, updatedAt: 0 }),
  );

  const emitChanged = () => {
    emitter.emit("changed");
  };

  const get = async (): Promise<SettingsRecord | null> => {
    const record = await port.get();
    return record ? SettingsRecordSchema.parse(record) : null;
  };

  const upsert = async (params: UpdateSettingsParams): Promise<SettingsRecord> => {
    writeQueue = writeQueue
      .catch(() => {
        return SettingsRecordSchema.parse({ id: "settings", activeChainRef: defaults.activeChainRef, updatedAt: 0 });
      })
      .then(async () => {
        const current = await port.get();
        const base = current ? SettingsRecordSchema.parse(current) : null;

        const selectedAccountId =
          params.selectedAccountId === undefined ? base?.selectedAccountId : (params.selectedAccountId ?? undefined);

        const next: SettingsRecord = SettingsRecordSchema.parse({
          id: "settings",
          activeChainRef: params.activeChainRef ?? base?.activeChainRef ?? defaults.activeChainRef,
          ...(selectedAccountId ? { selectedAccountId } : {}),
          updatedAt: clock(),
        });

        await port.put(next);
        emitChanged();
        return next;
      });

    return await writeQueue;
  };

  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    upsert,
  };
};
