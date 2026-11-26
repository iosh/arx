import type { AccountGroupId } from "@arx/core/accounts";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { useCopyToClipboard } from "@/ui/hooks/useCopyToClipboard";
import { getNamespaceUi } from "@/ui/namespaces";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";

export function ReceivePage({
  accountGroupId,
  accountId,
  from,
}: {
  accountGroupId: AccountGroupId;
  accountId: string;
  from: "home" | "account";
}) {
  const { t } = useTranslation(["wallet", "common"]);
  const { data: accountGroups, isFetching: readingAccounts } = useVisibleAccounts();
  const accountGroup = accountGroups?.find(
    (candidate) =>
      candidate.accountGroupId === accountGroupId &&
      candidate.accounts.some((account) => account.accountId === accountId),
  );
  const { data: source } = useMnemonicSource(accountGroup);
  const account = accountGroup?.accounts.find((candidate) => candidate.accountId === accountId);
  const address = account?.defaultAddress;
  const namespaceUi = account && getNamespaceUi(account.namespace);
  const name = accountGroup ? getAccountName(accountGroup, t) : undefined;
  const subtitle = source && name ? `${source.name} · ${name}` : name;
  const unavailable = accountGroups && !accountGroup ? t("accountUnavailable") : undefined;

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("receive")} · ARX`}</title>
      <PageHeader
        title={t("receive")}
        subtitle={subtitle}
        subtitleSpace
        backTo={from === "home" ? "/wallet" : "/wallet/accounts/$accountGroupId"}
        backLabel={t(from === "home" ? "backToHome" : "backToAccountDetails")}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-17.5 pb-3.5">
        <section
          aria-label={t("accountAddress")}
          className="flex flex-col items-center gap-4 rounded-2xl bg-card px-5 pt-6 pb-5 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
        >
          <div className="flex h-7 items-center">
            {namespaceUi && (
              <div className="flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs text-secondary-foreground">
                <namespaceUi.Icon compact />
                <span>{t(namespaceUi.labelKey)}</span>
              </div>
            )}
          </div>
          <div
            aria-busy={readingAccounts}
            className="flex size-49 shrink-0 items-center justify-center bg-white text-center text-sm text-neutral-600"
          >
            {address ? (
              <QRCodeSVG
                value={address}
                size={196}
                level="M"
                marginSize={4}
                title={t("addressQrCode")}
                role="img"
                aria-label={t("addressQrCode")}
              />
            ) : (
              unavailable && <p role="status">{unavailable}</p>
            )}
          </div>
          <div className="flex min-h-10.75 items-center justify-center">
            {address && namespaceUi && <namespaceUi.GroupedAddress address={address} />}
          </div>
          {address ? (
            <CopyAddressButton key={address} address={address} />
          ) : (
            <Button type="button" variant="secondary" className="h-10 w-full" disabled>
              <Copy aria-hidden="true" />
              {t("copyAddress")}
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}

function CopyAddressButton({ address }: { address: string }) {
  const { t } = useTranslation(["wallet", "common"]);
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full"
        disabled={isCopying}
        aria-busy={isCopying}
        onClick={() => copy(address)}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {t("copyAddress")}
      </Button>
      <p role="status" className={copyFailed ? "self-start text-xs text-destructive-foreground" : "sr-only"}>
        {copied ? t("addressCopied") : copyFailed ? t("copyAddressFailed") : ""}
      </p>
    </>
  );
}
