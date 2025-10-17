import type { ChainRegistryEntity } from "../storage/index.js";
import type { Caip2ChainId } from "./ids.js";

export interface ChainRegistryPort {
  get(chainRef: Caip2ChainId): Promise<ChainRegistryEntity | null>;
  getAll(): Promise<ChainRegistryEntity[]>;
  put(entity: ChainRegistryEntity): Promise<void>;
  putMany(entities: ChainRegistryEntity[]): Promise<void>;
  delete(chainRef: Caip2ChainId): Promise<void>;
  clear(): Promise<void>;
}
