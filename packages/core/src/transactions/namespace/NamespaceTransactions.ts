import type { AnyNamespaceTransaction, NamespaceTransaction } from "./types.js";

export class NamespaceTransactions {
  #transactionByNamespace: ReadonlyMap<string, AnyNamespaceTransaction>;

  constructor(initial?: Iterable<[string, AnyNamespaceTransaction]>) {
    const transactionByNamespace = new Map<string, AnyNamespaceTransaction>();

    for (const [namespace, transaction] of initial ?? []) {
      if (transactionByNamespace.has(namespace)) {
        throw new Error(`Duplicate namespace transaction "${namespace}"`);
      }
      transactionByNamespace.set(namespace, transaction);
    }

    this.#transactionByNamespace = transactionByNamespace;
  }

  find(namespace: string): AnyNamespaceTransaction | undefined {
    return this.#transactionByNamespace.get(namespace);
  }

  listNamespaces(): string[] {
    return [...this.#transactionByNamespace.keys()];
  }

  list(): AnyNamespaceTransaction[] {
    return [...this.#transactionByNamespace.values()];
  }

  entries(): Array<[string, AnyNamespaceTransaction]> {
    return [...this.#transactionByNamespace.entries()];
  }

  require(namespace: string): AnyNamespaceTransaction {
    const transaction = this.find(namespace);
    if (!transaction) {
      throw new Error(`Missing namespace transaction "${namespace}"`);
    }
    return transaction;
  }

  get(namespace: string): AnyNamespaceTransaction | undefined {
    return this.find(namespace);
  }
}
