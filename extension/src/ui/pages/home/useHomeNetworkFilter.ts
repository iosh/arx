import type { ChainRef } from "@arx/core/networks";
import { create } from "zustand";

type HomeNetworkFilterState = {
  chainRef: ChainRef | null;
  setChainRef(chainRef: ChainRef | null): void;
  clear(chainRef: ChainRef): void;
};

export const useHomeNetworkFilter = create<HomeNetworkFilterState>((set) => ({
  chainRef: null,
  setChainRef: (chainRef) => set({ chainRef }),
  clear: (chainRef) => set((state) => (state.chainRef === chainRef ? { chainRef: null } : state)),
}));
