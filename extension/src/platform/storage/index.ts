import type { StoragePort } from "@arx/core/storage";
import { createDexieStorage } from "@arx/storage-dexie";

let storageInstance: StoragePort | null = null;

export const getExtensionStorage = (): StoragePort => {
  if (storageInstance) {
    return storageInstance;
  }
  storageInstance = createDexieStorage({ databaseName: "arx-extension" });
  return storageInstance;
};
