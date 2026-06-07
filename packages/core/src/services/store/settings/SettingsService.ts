import type { SettingsRecord } from "../../../storage/records.js";
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
    return await port.get();
  };

  const update = async (params: UpdateSettingsParams): Promise<SettingsRecord> => {
    return await run(async () => {
      const current = await port.get();

      const selectedAccountKeysByNamespace: Record<string, string> = {
        ...(current?.selectedAccountKeysByNamespace ?? {}),
      };

      if (params.selectedAccountKeysByNamespace) {
        for (const [namespace, accountKey] of Object.entries(params.selectedAccountKeysByNamespace)) {
          const ns = namespace.trim();
          if (!ns) continue;
          if (!accountKey) {
            delete selectedAccountKeysByNamespace[ns];
            continue;
          }
          selectedAccountKeysByNamespace[ns] = accountKey;
        }
      }

      const next: SettingsRecord = {
        id: "settings",
        ...(Object.keys(selectedAccountKeysByNamespace).length > 0 ? { selectedAccountKeysByNamespace } : {}),
        updatedAt: clock(),
      };

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
