import { type SettingsRecord, SettingsRecordSchema } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { SettingsPort } from "./port.js";
import type { SettingsChangedPayload, SettingsService, UpdateSettingsParams } from "./types.js";

export type CreateSettingsServiceOptions = {
  port: SettingsPort;
  now?: () => number;
};

export const createSettingsService = ({ port, now }: CreateSettingsServiceOptions): SettingsService => {
  const clock = now ?? Date.now;
  const changed = createSignal<SettingsChangedPayload>();
  const run = createSerialQueue();

  const get = async (): Promise<SettingsRecord | null> => {
    const record = await port.get();
    if (!record) return null;
    const parsed = SettingsRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  const update = async (params: UpdateSettingsParams): Promise<SettingsRecord> => {
    return await run(async () => {
      const current = await port.get();
      const baseParsed = current ? SettingsRecordSchema.safeParse(current) : null;
      const base = baseParsed?.success ? baseParsed.data : null;

      const selectedAccountIdsByNamespace: Record<string, string> = {
        ...(base?.selectedAccountIdsByNamespace ?? {}),
      };

      if (params.selectedAccountIdsByNamespace) {
        for (const [namespace, accountId] of Object.entries(params.selectedAccountIdsByNamespace)) {
          const ns = namespace.trim();
          if (!ns) continue;
          if (!accountId) {
            delete selectedAccountIdsByNamespace[ns];
            continue;
          }
          selectedAccountIdsByNamespace[ns] = accountId;
        }
      }

      const next: SettingsRecord = SettingsRecordSchema.parse({
        id: "settings",
        ...(Object.keys(selectedAccountIdsByNamespace).length > 0 ? { selectedAccountIdsByNamespace } : {}),
        updatedAt: clock(),
      });

      await port.put(next);
      changed.emit({ next });
      return next;
    });
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    update,
  };
};
