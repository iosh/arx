import { parseChainRef } from "../../chains/caip.js";
import type { SwitchActiveAccountInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiAccountsSchemas } from "../schemas/accounts.js";

export const switchActiveAccount = async (context: WalletApiContext, input: SwitchActiveAccountInput) => {
  const params = WalletApiAccountsSchemas.switchActive.parse(input);
  const { namespace } = parseChainRef(params.chainRef);
  const active = await context.accounts.setActiveAccount({
    namespace,
    chainRef: params.chainRef,
    accountKey: params.accountKey ?? null,
  });

  return active
    ? {
        accountKey: active.accountKey,
        canonicalAddress: active.canonicalAddress,
        displayAddress: active.displayAddress,
      }
    : null;
};
