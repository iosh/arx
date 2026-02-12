import type { Json } from "@metamask/utils";
import type { LockedPolicy } from "./types.js";

export const lockedAllow = (): LockedPolicy => ({ allow: true });

export const lockedDeny = (): LockedPolicy => ({ allow: false });

export const lockedResponse = <T extends Json>(response: T): LockedPolicy => ({ response });
