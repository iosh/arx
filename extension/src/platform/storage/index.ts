import { createDexieStorage } from "@arx/storage-dexie";

let storage: ReturnType<typeof createDexieStorage> | null = null;

export const getExtensionStorage = () => {
  if (storage) return storage;
  storage = createDexieStorage({ databaseName: "arx-extension" });
  return storage;
};
