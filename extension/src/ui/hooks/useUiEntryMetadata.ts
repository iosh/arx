import { useSyncExternalStore } from "react";
import { getUiEntryMetadata, subscribeUiEntryMetadata } from "@/lib/uiEntryMetadata";

export const useUiEntryMetadata = () => {
  return useSyncExternalStore(subscribeUiEntryMetadata, getUiEntryMetadata, getUiEntryMetadata);
};
