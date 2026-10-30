import type { Account, AccountId } from "@arx/core/accounts";
import { Group as DropdownMenuGroup, Portal as DropdownMenuPortal } from "@radix-ui/react-dropdown-menu";
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
import { getNamespaceUi } from "@/ui/namespaces";
import { groupAccountsBySource } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useAccountAddresses } from "@/ui/wallet/accounts/useAccountAddresses";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useSelectAccount } from "@/ui/wallet/accounts/useSelectAccount";
import { useHdWallets, useMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";

export function AccountSwitcher({
  selectedAccount,
  selectedAccountPending,
}: Readonly<{
  selectedAccount: Account | undefined;
  selectedAccountPending: boolean;
}>) {
  const { t } = useTranslation("wallet");
  const [open, setOpen] = useState(false);
  const { mutate: selectAccount, isPending: isSelectingAccount } = useSelectAccount();
  const { data: visibleAccounts, isPending: accountsPending } = useVisibleAccounts();
  const { data: wallets = [], isPending: walletsPending } = useHdWallets();
  const accounts = selectedAccount
    ? visibleAccounts?.filter((account) => account.namespace === selectedAccount.namespace)
    : undefined;
  const groups = groupAccountsBySource(accounts ?? [], wallets);
  const menuPending = accountsPending || selectedAccountPending || walletsPending;

  function select(accountId: AccountId) {
    if (accountId === selectedAccount?.accountId) {
      setOpen(false);
      return;
    }
    selectAccount(accountId, { onSuccess: () => setOpen(false) });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <AccountSwitchTrigger account={selectedAccount} pending={selectedAccountPending} />
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
        className="flex w-93 max-w-[calc(100vw-1.75rem)] flex-col overflow-hidden rounded-2xl border-0 bg-card px-0 py-1 text-card-foreground shadow-none"
      >
        {menuPending && (
          <div className="flex h-13 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {accounts && (
          <DropdownMenuRadioGroup value={selectedAccount?.accountId} className="min-h-0 overflow-y-auto">
            {groups.map((group) => (
              <AccountSwitchGroup key={group.id} group={group} disabled={isSelectingAccount} onSelect={select} />
            ))}
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

function AccountSwitchTrigger({ account, pending }: { account: Account | undefined; pending: boolean }) {
  const { t } = useTranslation("wallet");
  const { data: source } = useMnemonicSource(account);
  const name = account ? getAccountName(account, t) : null;
  const sourceName = account?.origin.type === "private-key" ? t("privateKeyImport") : source?.name;

  return (
    <h1 className="min-w-0 flex-1 text-base font-semibold">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex h-11 w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {account && <AccountIdenticon accountId={account.accountId} />}
          <span className="flex h-11 min-w-0 flex-1 flex-col justify-center px-1">
            <span className="truncate text-xs leading-4 font-medium text-muted-foreground">{sourceName}</span>
            <span className="flex h-6 min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate">
                {pending ? <Spinner aria-label={t("loadingAccount")} /> : name}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.25 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180"
              />
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
    </h1>
  );
}

function AccountSwitchGroup({
  group,
  disabled,
  onSelect,
}: {
  group: ReturnType<typeof groupAccountsBySource>[number];
  disabled: boolean;
  onSelect(accountId: AccountId): void;
}) {
  if (group.type === "private-key") {
    return <AccountSwitchItem account={group.account} disabled={disabled} onSelect={onSelect} />;
  }

  return (
    <DropdownMenuGroup aria-label={group.source.name}>
      <div className="flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="truncate">{group.source.name}</span>
      </div>
      {group.accounts.map((account) => (
        <AccountSwitchItem key={account.accountId} account={account} disabled={disabled} onSelect={onSelect} />
      ))}
    </DropdownMenuGroup>
  );
}

function AccountSwitchItem({
  account,
  disabled,
  onSelect,
}: {
  account: Account;
  disabled: boolean;
  onSelect(accountId: AccountId): void;
}) {
  const { t } = useTranslation("wallet");
  const accountName = getAccountName(account, t);
  const {
    networkSelection: { isPending: networkPending },
    addresses: { data: addresses, isLoading: addressesLoading },
  } = useAccountAddresses(account);
  const addressPending = networkPending || addressesLoading;

  return (
    <DropdownMenuRadioItem
      value={account.accountId}
      textValue={accountName}
      disabled={disabled}
      className="h-14 gap-3 rounded-none px-4 pr-11 text-sm font-semibold [&>span:first-child]:right-4 [&>span:first-child]:size-4"
      onSelect={(event) => {
        event.preventDefault();
        onSelect(account.accountId);
      }}
    >
      <AccountIdenticon accountId={account.accountId} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{accountName}</span>
          {account.origin.type === "private-key" && (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-xs font-medium text-muted-foreground">
              {t("privateKey")}
            </span>
          )}
        </span>
        <span className="min-h-4 text-xs leading-4 font-normal text-muted-foreground">
          {addresses
            ? addresses.map((address) => {
                const { CompactAddress } = getNamespaceUi(address.namespace);
                return <CompactAddress key={address.address} address={address.address} />;
              })
            : addressPending && <Spinner aria-label={t("loadingAddress")} />}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
}
