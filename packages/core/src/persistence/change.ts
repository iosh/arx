import type { AnyPersistenceType } from "./definition.js";

export type PersistenceRemoveChangeOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends AnyPersistenceType ? ReturnType<TPersistenceType["remove"]> : never;

export type PersistencePutChangeOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends AnyPersistenceType ? ReturnType<TPersistenceType["put"]> : never;

export type PersistenceChangeOf<TPersistenceType extends AnyPersistenceType> =
  TPersistenceType extends AnyPersistenceType
    ? PersistencePutChangeOf<TPersistenceType> | PersistenceRemoveChangeOf<TPersistenceType>
    : never;
