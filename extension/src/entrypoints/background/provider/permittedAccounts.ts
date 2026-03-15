import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import type { BackgroundContext } from "../runtimeHost";
import type { ProviderBridgeSnapshot } from "../types";

type ProviderPermittedAccountsResolverDeps = {
  extensionOrigin: string;
  getContext: () => Promise<BackgroundContext>;
  getPortChainRef: (port: Runtime.Port) => string | null;
};

export const createProviderPermittedAccountsResolver = ({
  extensionOrigin,
  getContext,
  getPortChainRef,
}: ProviderPermittedAccountsResolverDeps) => {
  const listPermittedAccountsForPort = async (
    port: Runtime.Port,
    snapshot: ProviderBridgeSnapshot,
  ): Promise<string[]> => {
    if (!snapshot.isUnlocked) return [];

    const origin = getPortOrigin(port, extensionOrigin);
    if (origin === "unknown://") return [];

    const { controllers, permissionViews } = await getContext();
    const chainRef = getPortChainRef(port) ?? snapshot.chain.chainRef;

    return permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) =>
        controllers.chainAddressCodecs.formatAddress({ chainRef, canonical: account.canonicalAddress }),
      );
  };

  return {
    listPermittedAccountsForPort,
  };
};
