import type { Account, AccountGroup, AccountGroupId, AccountId } from "@arx/core/accounts";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { useCopyToClipboard } from "@/ui/hooks/useCopyToClipboard";
import { getNamespaceUi } from "@/ui/namespaces";

export function AccountAddressCard({
  accountGroup,
  accountId,
  copyable = true,
  receivable = false,
}: {
  accountGroup: AccountGroup | undefined;
  accountId?: AccountId;
  copyable?: boolean;
  receivable?: boolean;
}) {
  const { t } = useTranslation("wallet");

  return (
    <section
      aria-label={t("accountAddress")}
      className="min-h-17 shrink-0 rounded-2xl bg-card py-1 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
    >
      {accountGroup?.accounts
        .filter((account) => accountId === undefined || account.accountId === accountId)
        .map((account) => (
          <AddressRow
            key={account.accountId}
            accountGroupId={accountGroup.accountGroupId}
            account={account}
            copyable={copyable}
            receivable={receivable}
          />
        ))}
    </section>
  );
}

function AddressRow({
  accountGroupId,
  account,
  copyable,
  receivable,
}: {
  accountGroupId: AccountGroupId;
  account: Account;
  copyable: boolean;
  receivable: boolean;
}) {
  const { t } = useTranslation(["wallet", "common"]);
  const { Icon, labelKey } = getNamespaceUi(account.namespace);
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();
  const details = (
    <>
      <Icon />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{t(labelKey)}</span>
        <p dir="ltr" className="min-h-4 break-all text-xs font-medium text-muted-foreground">
          {account.defaultAddress}
        </p>
      </div>
    </>
  );

  return (
    <div>
      <div className="flex min-h-15 items-center gap-3 px-4 py-2">
        {receivable ? (
          <Link
            to="/wallet/accounts/$accountGroupId/receive/$accountId"
            params={{ accountGroupId, accountId: account.accountId }}
            aria-label={t("showAddressQrCode")}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {details}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{details}</div>
        )}
        {copyable && (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="rounded-[10px]"
            aria-label={t("copyAddress")}
            aria-busy={isCopying}
            title={t(copied ? "addressCopied" : "copyAddress")}
            disabled={isCopying}
            onClick={() => copy(account.defaultAddress)}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        )}
      </div>
      {copyable && (
        <p role="status" className={copyFailed ? "px-4 pb-2 text-xs text-destructive-foreground" : "sr-only"}>
          {copied ? t("addressCopied") : copyFailed ? t("copyAddressFailed") : ""}
        </p>
      )}
    </div>
  );
}
