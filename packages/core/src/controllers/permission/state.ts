import { ArxReasons, arxError } from "@arx/errors";
import { getAccountKeyNamespace } from "../../accounts/addressing/accountKey.js";
import { parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountKey, PermissionRecord } from "../../storage/records.js";
import type { ChainNamespace } from "../account/types.js";
import type {
  AuthorizationChainInput,
  ChainPermissionState,
  OriginPermissionState,
  PermissionAuthorization,
  PermissionsState,
} from "./types.js";

const sortStrings = <T extends string>(values: readonly T[]): T[] => {
  return [...values].sort((left, right) => left.localeCompare(right));
};

const uniqSorted = <T extends string>(values: readonly T[]): T[] => {
  return sortStrings([...new Set(values)]);
};

export const cloneChainStates = (
  chains: Record<ChainRef, ChainPermissionState>,
): Record<ChainRef, ChainPermissionState> => {
  return Object.fromEntries(
    Object.entries(chains).map(([chainRef, chainState]) => [
      chainRef,
      {
        accountKeys: [...chainState.accountKeys],
      },
    ]),
  ) as Record<ChainRef, ChainPermissionState>;
};

export const cloneOriginPermissionState = (state: OriginPermissionState): OriginPermissionState => {
  return Object.fromEntries(
    Object.entries(state).map(([namespace, namespaceState]) => [
      namespace,
      {
        chains: cloneChainStates(namespaceState.chains),
      },
    ]),
  ) as OriginPermissionState;
};

export const clonePermissionsState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(
    Object.entries(state.origins).map(([origin, originState]) => [origin, cloneOriginPermissionState(originState)]),
  ),
});

export const parsePermissionNamespace = (namespace: string): ChainNamespace => {
  const normalized = namespace.trim();
  if (!normalized) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Permission namespace is required",
      data: { namespace },
    });
  }

  return normalized as ChainNamespace;
};

export const parsePermissionChainRefForNamespace = (namespace: ChainNamespace, chainRef: ChainRef): ChainRef => {
  const parsed = parseCaipChainRef(chainRef);
  if (parsed.namespace !== namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Permission chainRef "${chainRef}" does not belong to namespace "${namespace}"`,
      data: { namespace, chainRef },
    });
  }

  return `${parsed.namespace}:${parsed.reference}` as ChainRef;
};

export const parsePermissionAccountKeysForNamespace = (
  namespace: ChainNamespace,
  accountKeys: readonly AccountKey[],
): AccountKey[] => {
  return uniqSorted(
    accountKeys.map((value) => {
      const accountKey = String(value) as AccountKey;
      if (getAccountKeyNamespace(accountKey) !== namespace) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: `Permission accountKey "${accountKey}" does not belong to namespace "${namespace}"`,
          data: { namespace, accountKey },
        });
      }

      return accountKey;
    }),
  );
};

export const buildValidatedPermissionChainStates = (
  namespace: ChainNamespace,
  chains: readonly AuthorizationChainInput[],
): Record<ChainRef, ChainPermissionState> => {
  if (chains.length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Permission chains must not be empty",
      data: { namespace },
    });
  }

  const normalizedEntries: Array<[ChainRef, ChainPermissionState]> = chains.map((chain) => [
    parsePermissionChainRefForNamespace(namespace, chain.chainRef),
    {
      accountKeys: parsePermissionAccountKeysForNamespace(namespace, chain.accountKeys),
    },
  ]);

  if (new Set(normalizedEntries.map(([chainRef]) => chainRef)).size !== normalizedEntries.length) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Permission chains must not contain duplicate chainRef values",
      data: { namespace },
    });
  }

  return Object.fromEntries(normalizedEntries.sort(([left], [right]) => left.localeCompare(right))) as Record<
    ChainRef,
    ChainPermissionState
  >;
};

export const mergeGrantedPermissionChainStates = (
  current: Record<ChainRef, ChainPermissionState> | null,
  granted: Record<ChainRef, ChainPermissionState>,
): Record<ChainRef, ChainPermissionState> => {
  const nextChains = current ? cloneChainStates(current) : {};

  for (const chainRef of sortStrings(Object.keys(granted) as ChainRef[])) {
    nextChains[chainRef] = {
      accountKeys: [...(granted[chainRef]?.accountKeys ?? [])],
    };
  }

  return nextChains;
};

const stableChainStateValue = (chains: Record<ChainRef, ChainPermissionState>): string => {
  return JSON.stringify(
    sortStrings(Object.keys(chains) as ChainRef[]).map((chainRef) => ({
      chainRef,
      accountKeys: uniqSorted(chains[chainRef]?.accountKeys ?? []),
    })),
  );
};

export const arePermissionChainStatesEqual = (
  left: Record<ChainRef, ChainPermissionState>,
  right: Record<ChainRef, ChainPermissionState>,
): boolean => {
  return stableChainStateValue(left) === stableChainStateValue(right);
};

export const buildPermissionRecordFromChainStates = (
  origin: string,
  namespace: ChainNamespace,
  chains: Record<ChainRef, ChainPermissionState>,
): PermissionRecord => {
  return {
    origin,
    namespace,
    chainScopes: Object.fromEntries(
      sortStrings(Object.keys(chains) as ChainRef[]).map((chainRef) => [
        chainRef,
        uniqSorted(chains[chainRef]?.accountKeys ?? []),
      ]),
    ),
  };
};

const buildNamespacePermissionState = (record: PermissionRecord) => ({
  chains: Object.fromEntries(
    sortStrings(Object.keys(record.chainScopes) as ChainRef[]).map((chainRef) => [
      chainRef,
      {
        accountKeys: uniqSorted(record.chainScopes[chainRef] ?? []),
      },
    ]),
  ) as Record<ChainRef, ChainPermissionState>,
});

export const buildPermissionsStateFromRecords = (records: readonly PermissionRecord[]): PermissionsState => {
  const nextOrigins: PermissionsState["origins"] = {};

  for (const record of records) {
    const originState = nextOrigins[record.origin] ?? {};
    originState[record.namespace] = buildNamespacePermissionState(record);
    nextOrigins[record.origin] = originState;
  }

  return { origins: nextOrigins };
};

export const buildPermissionAuthorization = (
  origin: string,
  namespace: ChainNamespace,
  chains: Record<ChainRef, ChainPermissionState>,
): PermissionAuthorization => {
  return {
    origin,
    namespace,
    chains: cloneChainStates(chains),
  };
};
