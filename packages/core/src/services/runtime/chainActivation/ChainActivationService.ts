import type { ChainRef } from "../../../chains/ids.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../store/networkPreferences/types.js";
import type { ChainActivationService } from "./types.js";

export type CreateChainActivationServiceOptions = {
  network: Pick<NetworkController, "getState" | "switchChain">;
  preferences: Pick<NetworkPreferencesService, "setActiveChainRef">;
  logger?: (message: string, error?: unknown) => void;
};

export const createChainActivationService = ({
  network,
  preferences,
  logger = () => {},
}: CreateChainActivationServiceOptions): ChainActivationService => {
  const activate = async (chainRef: ChainRef): Promise<void> => {
    const previousActive = network.getState().activeChainRef;
    const switched = previousActive !== chainRef;

    if (switched) {
      await network.switchChain(chainRef);
    }

    try {
      await preferences.setActiveChainRef(chainRef);
    } catch (error) {
      if (switched) {
        try {
          await network.switchChain(previousActive);
        } catch (rollbackError) {
          logger("chainActivation: failed to rollback active chain after persistence failure", rollbackError);
        }
      }
      throw error;
    }
  };

  return { activate };
};
