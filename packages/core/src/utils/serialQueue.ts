export const createSerialQueue = () => {
  let queue: Promise<unknown> = Promise.resolve();

  return async <T>(task: () => Promise<T>): Promise<T> => {
    queue = queue.then(task, task);
    return queue as Promise<T>;
  };
};
