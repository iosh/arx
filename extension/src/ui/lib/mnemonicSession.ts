type MnemonicSessionState = {
  words: string[];
};

class MnemonicSessionStore {
  #state: MnemonicSessionState | null = null;

  store(words: string[]) {
    this.#state = { words: [...words] };
  }

  peek(): string[] | null {
    return this.#state ? [...this.#state.words] : null;
  }

  clear() {
    this.#state = null;
  }
}

export const mnemonicSession = new MnemonicSessionStore();
