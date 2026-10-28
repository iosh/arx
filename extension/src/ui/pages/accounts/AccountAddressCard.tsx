import type { Account, Address } from "@arx/core/accounts";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountAddresses } from "@/ui/wallet/accounts/useAccountAddresses";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function AccountAddressCard({ account }: { account: Account }) {
  const { t } = useTranslation("wallet");
  const {
    networkSelection: { isPending: networkPending },
    addresses: { data: addresses, isFetching: addressesFetching },
  } = useAccountAddresses(account);
  const loading = networkPending || addressesFetching;

  return (
    <section
      aria-label={t("accountAddress")}
      className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
    >
      {addresses ? (
        addresses.map((address) => <AddressRow key={address.address} address={address} />)
      ) : loading ? (
        <div className="flex min-h-15 items-center px-4 text-sm text-muted-foreground">
          <Spinner aria-label={t("loadingAddress")} />
        </div>
      ) : null}
    </section>
  );
}

function AddressRow({ address }: { address: Address }) {
  const { t } = useTranslation(["wallet", "common"]);
  const { Icon, labelKey } = getNamespaceUi(address.namespace);
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();

  return (
    <div>
      <div className="flex min-h-15 items-center gap-3 px-4 py-2">
        <Icon />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">{t(labelKey)}</span>
          <p dir="ltr" className="break-all text-xs font-medium text-muted-foreground">
            {address.address}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="rounded-[10px]"
          aria-label={t("copyAddress")}
          aria-busy={isCopying}
          title={t(copied ? "addressCopied" : "copyAddress")}
          disabled={isCopying}
          onClick={() => copy(address.address)}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      <p role="status" className={copyFailed ? "px-4 pb-2 text-xs text-destructive-foreground" : "sr-only"}>
        {copied ? t("addressCopied") : copyFailed ? t("copyAddressFailed") : ""}
      </p>
    </div>
  );
}
