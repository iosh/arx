declare const persistenceTypeMarker: unique symbol;

/** Defines pure writes for a canonical persistence value addressed by a stable domain key. */
export type KeyedPersistenceType<TName extends string, TValue, TKey> = Readonly<{
  name: TName;
  identity: "keyed";
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
  [persistenceTypeMarker]?: readonly [value: TValue, key: TKey];
}>;

/** Defines pure writes for the sole canonical persistence value of its type. */
export type SingletonPersistenceType<TName extends string, TValue> = Readonly<{
  name: TName;
  identity: "singleton";
  put(value: TValue): Readonly<{
    persistenceType: TName;
    operation: "put";
    value: TValue;
  }>;
  remove(): Readonly<{
    persistenceType: TName;
    operation: "remove";
  }>;
  [persistenceTypeMarker]?: readonly [value: TValue];
}>;

export type AnyPersistenceType =
  | KeyedPersistenceType<string, unknown, unknown>
  | SingletonPersistenceType<string, unknown>;

export type PersistenceValueOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends KeyedPersistenceType<string, infer TValue, unknown>
    ? TValue
    : TPersistenceType extends SingletonPersistenceType<string, infer TValue>
      ? TValue
      : never;

export type PersistenceKeyOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends KeyedPersistenceType<string, unknown, infer TKey> ? TKey : never;

export const defineKeyedPersistenceType = <const TName extends string, TValue, TKey>(
  name: TName,
): KeyedPersistenceType<TName, TValue, TKey> => ({
  name,
  identity: "keyed",
  put: (value) => ({ persistenceType: name, operation: "put", value }),
  remove: (key) => ({ persistenceType: name, operation: "remove", key }),
});

export const defineSingletonPersistenceType = <const TName extends string, TValue>(
  name: TName,
): SingletonPersistenceType<TName, TValue> => ({
  name,
  identity: "singleton",
  put: (value) => ({ persistenceType: name, operation: "put", value }),
  remove: () => ({ persistenceType: name, operation: "remove" }),
});
