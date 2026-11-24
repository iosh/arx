/** Defines pure writes for a canonical persistence value addressed by a stable domain key. */
export type KeyedPersistenceType<TName extends string, TValue, TKey> = Readonly<{
  name: TName;
  put(value: TValue): Readonly<{
    persistenceType: TName;
    operation: "put";
    value: TValue;
  }>;
  remove(key: TKey): Readonly<{
    persistenceType: TName;
    operation: "remove";
    key: TKey;
  }>;
}>;

/** Defines pure writes for the sole canonical persistence value of its type. */
export type SingletonPersistenceType<TName extends string, TValue> = Readonly<{
  name: TName;
  put(value: TValue): Readonly<{
    persistenceType: TName;
    operation: "put";
    value: TValue;
  }>;
  remove(): Readonly<{
    persistenceType: TName;
    operation: "remove";
  }>;
}>;

export const defineKeyedPersistenceType = <const TName extends string, TValue, TKey>(
  name: TName,
): KeyedPersistenceType<TName, TValue, TKey> => ({
  name,
  put: (value) => ({ persistenceType: name, operation: "put", value }),
  remove: (key) => ({ persistenceType: name, operation: "remove", key }),
});

export const defineSingletonPersistenceType = <const TName extends string, TValue>(
  name: TName,
): SingletonPersistenceType<TName, TValue> => ({
  name,
  put: (value) => ({ persistenceType: name, operation: "put", value }),
  remove: () => ({ persistenceType: name, operation: "remove" }),
});
