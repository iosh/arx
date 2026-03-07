import type { ChainRef } from "../../../chains/ids.js";
import type { ChainDefinitionEntity } from "../../../storage/index.js";

export interface ChainDefinitionsPort {
  get(chainRef: ChainRef): Promise<ChainDefinitionEntity | null>;
  getAll(): Promise<ChainDefinitionEntity[]>;
  put(entity: ChainDefinitionEntity): Promise<void>;
  putMany(entities: ChainDefinitionEntity[]): Promise<void>;
  delete(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
