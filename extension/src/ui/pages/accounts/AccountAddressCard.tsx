import type { AccountGroup, AccountGroupId, AccountId, AccountMember, Address } from "@arx/core/accounts";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { useCopyToClipboard } from "@/ui/hooks/useCopyToClipboard";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountAddresses } from "@/ui/wallet/accounts/useAccountAddresses";

export function AccountAddressCard({
  account,
  memberId,
  copyable = true,
  receivable = false,
}: {
  account: AccountGroup | undefined;
  memberId?: AccountId;
  copyable?: boolean;
  receivable?: boolean;
}) {
  const { t } = useTranslation("wallet");
  const { data: addresses, isFetching } = useAccountAddresses(account);

  return (
    <section
      aria-label={t("accountAddress")}
      aria-busy={isFetching}
      className="min-h-17 shrink-0 rounded-2xl bg-card py-1 text-card-foreground shadow-[0_1px_3px_var(--shadow)]"
    >
      {account?.members
        .filter((member) => memberId === undefined || member.accountId === memberId)
        .map((member) => (
          <AddressRow
            key={member.accountId}
            accountGroupId={account.accountGroupId}
            member={member}
            address={addresses?.find((address) => address.accountId === member.accountId)}
            copyable={copyable}
            receivable={receivable}
          />
        ))}
    </section>
  );
}

function AddressRow({
  accountGroupId,
  member,
  address,
  copyable,
  receivable,
}: {
  accountGroupId: AccountGroupId;
  member: AccountMember;
  address: Address | undefined;
  copyable: boolean;
  receivable: boolean;
}) {
  const { t } = useTranslation(["wallet", "common"]);
  const { Icon, labelKey } = getNamespaceUi(member.namespace);
  const { copy, isCopying, copied, copyFailed } = useCopyToClipboard();
  const details = (
    <>
      <Icon />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{t(labelKey)}</span>
        <p dir="ltr" className="min-h-4 break-all text-xs font-medium text-muted-foreground">
          {address?.address}
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
            params={{ accountGroupId, accountId: member.accountId }}
            disabled={!address}
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
            disabled={!address || isCopying}
            onClick={address ? () => copy(address.address) : undefined}
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
