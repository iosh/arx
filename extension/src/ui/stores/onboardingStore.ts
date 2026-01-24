import { create } from "zustand";

export type OnboardingStore = {
  password: string | null;
  mnemonicWords: string[] | null;
  mnemonicKeyringId: string | null;

  setPassword: (password: string) => void;
  setMnemonicWords: (words: string[]) => void;
  setMnemonicKeyringId: (keyringId: string) => void;

  clearPassword: () => void;
  clearMnemonicWords: () => void;
  clear: () => void;
};
export const useOnboardingStore = create<OnboardingStore>((set) => ({
  password: null,
  mnemonicWords: null,
  mnemonicKeyringId: null,

  setPassword: (password) => set({ password }),
  setMnemonicWords: (words) => set({ mnemonicWords: [...words] }),
  setMnemonicKeyringId: (keyringId) => set({ mnemonicKeyringId: keyringId }),

  clearPassword: () => set({ password: null }),
  clearMnemonicWords: () => set({ mnemonicWords: null, mnemonicKeyringId: null }),
  clear: () => set({ password: null, mnemonicWords: null, mnemonicKeyringId: null }),
}));
