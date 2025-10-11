import type { MethodDefinition } from "./types.js";

type LockedPolicy = NonNullable<MethodDefinition["locked"]>;

export const lockedAllow = (): LockedPolicy => ({ allow: true });

export const lockedResponse = <T>(response: T): LockedPolicy => ({ response });
