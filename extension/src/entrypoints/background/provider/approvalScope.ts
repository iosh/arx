import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import type { BackgroundContext } from "../runtimeHost";

const toErrorDetails = (error: unknown): Record<string, string> => {
  if (!error) return {};
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { error: String(error) };
};

type ProviderApprovalScopeCancellerDeps = {
  extensionOrigin: string;
  getContext: () => Promise<BackgroundContext>;
  getPortId: (port: Runtime.Port) => string | null;
  portLog: (message: string, details?: Record<string, unknown>) => void;
};

export const createProviderApprovalScopeCanceller = ({
  extensionOrigin,
  getContext,
  getPortId,
  portLog,
}: ProviderApprovalScopeCancellerDeps) => {
  const cancelByPortSession = async (port: Runtime.Port, sessionId: string, logReason: string) => {
    const portId = getPortId(port);
    if (!portId) return;

    try {
      const { controllers } = await getContext();
      await controllers.approvals.cancelByScope({
        scope: {
          transport: "provider",
          origin: getPortOrigin(port, extensionOrigin),
          portId,
          sessionId,
        },
        reason: "session_lost",
      });
    } catch (error) {
      const origin = getPortOrigin(port, extensionOrigin);
      portLog(logReason, { origin, ...toErrorDetails(error) });
    }
  };

  return {
    cancelByPortSession,
  };
};
