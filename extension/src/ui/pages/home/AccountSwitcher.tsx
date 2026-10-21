import type { Account } from "@arx/core/accounts";
import { Portal as DropdownMenuPortal } from "@radix-ui/react-dropdown-menu";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

export function AccountSwitcher({
  accounts,
  selectedAccount,
  isSelectedPending,
  isPending,
  isLoadingError,
}: Readonly<{
  accounts: readonly Account[] | undefined;
  selectedAccount: Account | undefined;
  isSelectedPending: boolean;
  isPending: boolean;
  isLoadingError: boolean;
}>) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const [open, setOpen] = useState(false);
  const { mutate: selectAccount, isPending: isSelectingAccount } = useMutation({
    mutationFn: (accountId: Account["accountId"]) => wallet.accounts.select({ accountId }),
  });
  const name = selectedAccount ? getAccountName(selectedAccount, t) : t("accountUnavailable");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <h1 className="min-w-0 flex-1 text-base font-semibold">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-11 w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selectedAccount && <AccountIdenticon accountId={selectedAccount.accountId} />}
            <span className="flex min-w-0 items-center gap-1 px-1">
              <span className="truncate">
                {isSelectedPending ? <Spinner aria-label={t("loadingAccount")} /> : name}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.25 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180"
              />
            </span>
          </button>
        </DropdownMenuTrigger>
      </h1>
      {open && (
        <DropdownMenuPortal>
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 bg-overlay" />
        </DropdownMenuPortal>
      )}
      <DropdownMenuContent
        align="start"
        alignOffset={-6}
        sideOffset={6}
        collisionPadding={14}
        className="flex w-93 flex-col overflow-hidden rounded-2xl border-0 bg-card px-0 py-1 text-card-foreground shadow-none"
      >
        {isPending && (
          <div className="flex h-13 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {isLoadingError && (
          <div className="flex h-13 items-center px-4 text-sm text-muted-foreground">{t("accountsUnavailable")}</div>
        )}
        {accounts && (
          <DropdownMenuRadioGroup value={selectedAccount?.accountId} className="min-h-0 overflow-y-auto">
            {accounts.map((account) => {
              const accountName = getAccountName(account, t);
              return (
                <DropdownMenuRadioItem
                  key={account.accountId}
                  value={account.accountId}
                  textValue={accountName}
                  disabled={isSelectingAccount}
                  className="h-13 gap-3 rounded-none px-4 pr-11 text-sm font-semibold [&>span:first-child]:right-4 [&>span:first-child]:size-4"
                  onSelect={(event) => {
                    event.preventDefault();
                    if (account.accountId === selectedAccount?.accountId) {
                      setOpen(false);
                      return;
                    }
                    selectAccount(account.accountId, { onSuccess: () => setOpen(false) });
                  }}
                >
                  <AccountIdenticon accountId={account.accountId} size={32} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate">{accountName}</span>
                    {account.origin.type === "private-key" && (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-xs font-medium text-muted-foreground">
                        {t("privateKey")}
                      </span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuItem
          asChild
          className="h-12 shrink-0 gap-3 rounded-none border-t border-border px-4 text-sm font-semibold"
        >
          <Link to="/wallet/accounts">
            <span className="flex size-8 items-center justify-center">
              <Settings2 aria-hidden="true" className="size-4" />
            </span>
            {t("manageAccounts")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
