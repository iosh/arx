import type { AccountGroup, AccountGroupId, AccountId, Address } from "@arx/core/accounts";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { useCopyToClipboard } from "@/ui/hooks/useCopyToClipboard";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountAddresses } from "@/ui/wallet/accounts/useAccountAddresses";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";

export function ReceivePage({
  accountGroupId,
  accountId,
  from,
}: {
  accountGroupId: AccountGroupId;
  accountId: AccountId;
  from: "home" | "account";
}) {
  const { t } = useTranslation("wallet");
  const { data: accounts, isPending } = useVisibleAccounts();
  const account = accounts?.find(
    (candidate) =>
      candidate.accountGroupId === accountGroupId && candidate.members.some((member) => member.accountId === accountId),
  );
  const { data: source } = useMnemonicSource(account);
  const name = account ? getAccountName(account, t) : undefined;
  const subtitle = source && name ? `${source.name} · ${name}` : name;

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("receive")} · ARX`}</title>
      <PageHeader
        title={t("receive")}
        subtitle={subtitle}
        backTo={from === "home" ? "/wallet" : "/wallet/accounts/$accountGroupId"}
        backLabel={t(from === "home" ? "backToHome" : "backToAccountDetails")}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-17.5 pb-3.5">
        {account ? (
          <ReceiveAddress account={account} accountId={accountId} />
        ) : (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {isPending ? <Spinner aria-label={t("loadingAccount")} /> : t("accountUnavailable")}
          </div>
        )}
      </div>
    </main>
  );
}

function ReceiveAddress({ account, accountId }: { account: AccountGroup; accountId: AccountId }) {
  const { t } = useTranslation("wallet");
  const { data: addresses, isPending } = useAccountAddresses(account);
  const address = addresses?.find((candidate) => candidate.accountId === accountId);

  if (address) return <ReceiveAddressCard key={address.address} address={address} />;

  return (
    <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
      {isPending ? <Spinner aria-label={t("loadingAddress")} /> : t("addressUnavailable")}
    </div>
  );
}

function ReceiveAddressCard({ address }: { address: Address }) {
  const { t } = useTranslation(["wallet", "common"]);
  const { Icon, labelKey, GroupedAddress } = getNamespaceUi(address.namespace);
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();

  return (
    <section
      aria-label={t("accountAddress")}
      className="flex flex-col items-center gap-4 rounded-2xl bg-card px-5 pt-6 pb-5 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
    >
      <div className="flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs text-secondary-foreground">
        <Icon compact />
        <span>{t(labelKey)}</span>
      </div>
      <QRCodeSVG
        value={address.address}
        size={196}
        level="M"
        marginSize={4}
        title={t("addressQrCode")}
        role="img"
        aria-label={t("addressQrCode")}
      />
      <GroupedAddress address={address.address} />
      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full"
        disabled={isCopying}
        aria-busy={isCopying}
        onClick={() => copy(address.address)}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {t("copyAddress")}
      </Button>
      <p role="status" className={copyFailed ? "self-start text-xs text-destructive-foreground" : "sr-only"}>
        {copied ? t("addressCopied") : copyFailed ? t("copyAddressFailed") : ""}
      </p>
    </section>
  );
}
