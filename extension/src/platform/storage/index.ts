import { createDexiePersistence } from "@arx/storage-dexie";

let storage: ReturnType<typeof createDexiePersistence> | null = null;

export const getExtensionStorage = () => {
  if (storage) return storage;
  storage = createDexiePersistence({ databaseName: "arx-extension" });
  return storage;
};
