import type { ChainRef } from "../../../chains/ids.js";

export type ChainActivationService = {
  activate(chainRef: ChainRef): Promise<void>;
};
