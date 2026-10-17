import type { AccountId } from "@arx/core/accounts";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EvmNetworkIcon } from "@/ui/components/EvmNetworkIcon";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { useAccountAddress } from "./useAccountAddress";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function AccountAddressCard({ accountId }: { accountId: AccountId }) {
  const { t } = useTranslation(["wallet", "common"]);
  const { data: accountAddress, isPending } = useAccountAddress(accountId, "eip155:1");
  const address = accountAddress?.displayAddress;
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();

  return (
    <section
      aria-label={t("accountAddress")}
      className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
    >
      <div className="flex min-h-15 items-center gap-3 px-4 py-2">
        <EvmNetworkIcon />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">{t("common:evmNetworks")}</span>
          {address ? (
            <p dir="ltr" className="break-all text-xs font-medium text-muted-foreground">
              {address}
            </p>
          ) : isPending ? (
            <Spinner aria-label={t("loadingAddress")} className="size-3" />
          ) : (
            <span className="text-xs text-muted-foreground">{t("addressUnavailable")}</span>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="rounded-[10px]"
          aria-label={t("copyAddress")}
          aria-busy={isCopying}
          title={t(copied ? "addressCopied" : "copyAddress")}
          disabled={!address || isCopying}
          onClick={() => {
            if (address) copy(address);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      <p role="status" className={copyFailed ? "px-4 pb-2 text-xs text-destructive-foreground" : "sr-only"}>
        {copied ? t("addressCopied") : copyFailed ? t("copyAddressFailed") : ""}
      </p>
    </section>
  );
}
