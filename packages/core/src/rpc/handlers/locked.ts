import type { Json } from "@metamask/utils";
import type { LockedPolicy } from "./types.js";

export const lockedAllow = (): LockedPolicy => ({ type: "allow" });

export const lockedDeny = (): LockedPolicy => ({ type: "deny" });

export const lockedQueue = (): LockedPolicy => ({ type: "queue" });

export const lockedResponse = <T extends Json>(response: T): LockedPolicy => ({ type: "response", response });
