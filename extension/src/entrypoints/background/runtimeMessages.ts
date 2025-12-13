import type { UnlockReason } from "@arx/core";
import type { Runtime } from "webextension-polyfill";
import type { BackgroundContext } from "./serviceManager";
import type { SessionMessage } from "./types";

type RuntimeMessageDeps = {
  ensureContext: () => Promise<BackgroundContext>;
  persistVaultMeta: (target?: BackgroundContext | null) => Promise<void>;
  runtimeId: string;
};

export const createRuntimeMessageProxy = ({ ensureContext, persistVaultMeta, runtimeId }: RuntimeMessageDeps) => {
  const handleRuntimeMessage = async (message: SessionMessage, sender: Runtime.MessageSender) => {
    if (sender.id !== runtimeId) {
      throw new Error("Unauthorized sender");
    }

    const background = await ensureContext();
    const { session } = background;
    const { unlock, vault } = session;
    switch (message.type) {
      case "session:getStatus": {
        return {
          state: unlock.getState(),
          vault: vault.getStatus(),
        };
      }
      case "session:unlock": {
        const { password } = message.payload;
        await unlock.unlock({ password });
        await persistVaultMeta(background);
        return unlock.getState();
      }

      case "session:lock": {
        const reason: UnlockReason = message.payload?.reason ?? "manual";
        unlock.lock(reason);
        await persistVaultMeta(background);
        return unlock.getState();
      }
      case "vault:initialize": {
        const { password } = message.payload;
        const ciphertext = await vault.initialize({ password });
        await persistVaultMeta(background);
        return { ciphertext };
      }
      default:
        throw new Error(`Unknown runtime message: ${message}`);
    }
  };

  return (message: unknown, sender: Runtime.MessageSender) => handleRuntimeMessage(message as SessionMessage, sender);
};
