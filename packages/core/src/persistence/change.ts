export type PersistenceChangeOf<TPersistenceType> = TPersistenceType extends {
  put: (...args: never[]) => infer TPut;
  remove: (...args: never[]) => infer TRemove;
}
  ? TPut | TRemove
  : never;
