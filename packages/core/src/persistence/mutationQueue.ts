import type { PersistenceWriter } from "./contract.js";

export interface CoreMutationQueue {
  /** Runs one mutation through commit, activation, and publication before the next mutation starts. */
  run<T>(mutation: (commit: PersistenceWriter["commit"]) => Promise<T>): Promise<T>;
}

export const createCoreMutationQueue = (writer: PersistenceWriter): CoreMutationQueue => {
  const commit = writer.commit.bind(writer);
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(mutation: (commit: PersistenceWriter["commit"]) => Promise<T>): Promise<T> {
      const result = tail.then(() => mutation(commit));
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
};
