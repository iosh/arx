import { getAccountIdNamespace } from "../../accounts/addressing/accountId.js";
import type { ChainNamespace } from "../../accounts/selection/types.js";
import { CAIP2_NAMESPACE_PATTERN, parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import { type AccountId, AccountIdSchema, type PermissionRecord } from "../../storage/records.js";
import type {
  AuthorizationChainInput,
  ChainPermissionState,
  OriginPermissionState,
  PermissionAuthorization,
  PermissionsState,
} from "./types.js";

export const sortStrings = <T extends string>(values: readonly T[]): T[] => {
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
        accountIds: [...chainState.accountIds],
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
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new RpcInvalidRequestError({
      message: "Permission namespace is required",
      details: { namespace },
    });
  }

  if (namespace.trim() !== namespace || !CAIP2_NAMESPACE_PATTERN.test(namespace)) {
    throw new RpcInvalidRequestError({
      message: `Invalid permission namespace "${namespace}"`,
      details: { namespace },
    });
  }

  return namespace as ChainNamespace;
};

export const parsePermissionChainRefForNamespace = (namespace: ChainNamespace, chainRef: ChainRef): ChainRef => {
  const parsed = parseCaipChainRef(chainRef);
  if (parsed.namespace !== namespace) {
    throw new RpcInvalidRequestError({
      message: `Permission chainRef "${chainRef}" does not belong to namespace "${namespace}"`,
      details: { namespace, chainRef },
    });
  }

  return `${parsed.namespace}:${parsed.reference}` as ChainRef;
};

export const parsePermissionAccountIdsForNamespace = (
  namespace: ChainNamespace,
  accountIds: readonly AccountId[],
): AccountId[] => {
  return uniqSorted(
    accountIds.map((value) => {
      const parsed = AccountIdSchema.safeParse(value);
      if (!parsed.success) {
        throw new RpcInvalidRequestError({
          message: "Permission accountId is invalid",
          details: { namespace },
        });
      }

      const accountId = parsed.data;
      if (getAccountIdNamespace(accountId) !== namespace) {
        throw new RpcInvalidRequestError({
          message: `Permission account does not belong to namespace "${namespace}"`,
          details: { namespace },
        });
      }

      return accountId;
    }),
  );
};

export const buildValidatedPermissionChainStates = (
  namespace: ChainNamespace,
  chains: readonly AuthorizationChainInput[],
): Record<ChainRef, ChainPermissionState> => {
  if (chains.length === 0) {
    throw new RpcInvalidRequestError({
      message: "Permission chains must not be empty",
      details: { namespace },
    });
  }

  const normalizedEntries: Array<[ChainRef, ChainPermissionState]> = chains.map((chain) => [
    parsePermissionChainRefForNamespace(namespace, chain.chainRef),
    {
      accountIds: parsePermissionAccountIdsForNamespace(namespace, chain.accountIds),
    },
  ]);

  if (new Set(normalizedEntries.map(([chainRef]) => chainRef)).size !== normalizedEntries.length) {
    throw new RpcInvalidRequestError({
      message: "Permission chains must not contain duplicate chainRef values",
      details: { namespace },
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
      accountIds: [...(granted[chainRef]?.accountIds ?? [])],
    };
  }

  return nextChains;
};

const stableChainStateValue = (chains: Record<ChainRef, ChainPermissionState>): string => {
  return JSON.stringify(
    sortStrings(Object.keys(chains) as ChainRef[]).map((chainRef) => ({
      chainRef,
      accountIds: uniqSorted(chains[chainRef]?.accountIds ?? []),
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
        uniqSorted(chains[chainRef]?.accountIds ?? []),
      ]),
    ),
  };
};

const buildNamespacePermissionState = (record: PermissionRecord) => ({
  chains: Object.fromEntries(
    sortStrings(Object.keys(record.chainScopes) as ChainRef[]).map((chainRef) => [
      chainRef,
      {
        accountIds: uniqSorted(record.chainScopes[chainRef] ?? []),
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
