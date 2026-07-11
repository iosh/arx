import type {
  AnyPersistenceType,
  KeyedPersistenceType,
  PersistenceKeyOf,
  PersistenceValueOf,
  SingletonPersistenceType,
} from "./definition.js";

export type PersistencePutChangeOf<TPersistenceType extends AnyPersistenceType> = Readonly<{
  persistenceType: TPersistenceType["name"];
  operation: "put";
  value: PersistenceValueOf<TPersistenceType>;
}>;

type PersistenceRemoveTarget<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends KeyedPersistenceType<string, unknown, unknown>
    ? { key: PersistenceKeyOf<TPersistenceType> }
    : unknown;

export type PersistenceRemoveChangeOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends AnyPersistenceType
    ? Readonly<
        {
          persistenceType: TPersistenceType["name"];
          operation: "remove";
        } & PersistenceRemoveTarget<TPersistenceType>
      >
    : never;

export type PersistenceChangeOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends AnyPersistenceType
    ? PersistencePutChangeOf<TPersistenceType> | PersistenceRemoveChangeOf<TPersistenceType>
    : never;

const put = <TPersistenceType extends AnyPersistenceType>(
  persistenceType: TPersistenceType,
  value: PersistenceValueOf<TPersistenceType>,
): PersistencePutChangeOf<TPersistenceType> =>
  ({
    persistenceType: persistenceType.name,
    operation: "put",
    value,
  }) as PersistencePutChangeOf<TPersistenceType>;

function remove<TPersistenceType extends SingletonPersistenceType<string, unknown>>(
  persistenceType: TPersistenceType,
): PersistenceRemoveChangeOf<TPersistenceType>;
function remove<TPersistenceType extends KeyedPersistenceType<string, unknown, unknown>>(
  persistenceType: TPersistenceType,
  key: PersistenceKeyOf<TPersistenceType>,
): PersistenceRemoveChangeOf<TPersistenceType>;
function remove(persistenceType: AnyPersistenceType, key?: unknown): PersistenceRemoveChangeOf<AnyPersistenceType> {
  if (persistenceType.identity === "singleton") {
    return {
      persistenceType: persistenceType.name,
      operation: "remove",
    } as PersistenceRemoveChangeOf<AnyPersistenceType>;
  }

  return {
    persistenceType: persistenceType.name,
    operation: "remove",
    key,
  } as PersistenceRemoveChangeOf<AnyPersistenceType>;
}

export const persistenceChange = {
  put,
  remove,
} as const;
