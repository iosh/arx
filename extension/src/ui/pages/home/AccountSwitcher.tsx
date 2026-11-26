import type { AccountGroup, AccountGroupId } from "@arx/core/accounts";
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
import { getNamespaceUi } from "@/ui/namespaces";
import { groupAccountsBySource } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useSelectAccount } from "@/ui/wallet/accounts/useSelectAccount";
import { useMnemonicSource, useMnemonicSources } from "@/ui/wallet/keyring/useMnemonicSources";

export function AccountSwitcher({ selectedGroup }: Readonly<{ selectedGroup: AccountGroup | undefined }>) {
  const { t } = useTranslation("wallet");
  const [open, setOpen] = useState(false);
  const { mutate: selectAccount, isPending: isSelectingAccount } = useSelectAccount();
  const { data: accountGroups } = useVisibleAccounts();
  const { data: wallets } = useMnemonicSources();
  const groups = accountGroups && groupAccountsBySource(accountGroups, wallets);

  function select(accountGroupId: AccountGroupId) {
    if (accountGroupId === selectedGroup?.accountGroupId) {
      setOpen(false);
      return;
    }
    selectAccount(accountGroupId, { onSuccess: () => setOpen(false) });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <AccountSwitchTrigger accountGroup={selectedGroup} />
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
        <DropdownMenuRadioGroup value={selectedGroup?.accountGroupId} className="min-h-14 overflow-y-auto">
          {groups?.map((group) => (
            <AccountSwitchGroup key={group.id} group={group} disabled={isSelectingAccount} onSelect={select} />
          ))}
        </DropdownMenuRadioGroup>
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

function AccountSwitchTrigger({ accountGroup }: { accountGroup: AccountGroup | undefined }) {
  const { t } = useTranslation("wallet");
  const { data: source } = useMnemonicSource(accountGroup);
  const name = accountGroup ? getAccountName(accountGroup, t) : null;
  const sourceName = accountGroup?.source.type === "private-key" ? t("privateKeyImport") : source?.name;

  return (
    <h1 className="min-w-0 flex-1 text-base font-semibold">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={name ? `${t("switchAccount")} · ${name}` : t("switchAccount")}
          className="group grid h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {accountGroup && <AccountIdenticon seed={accountGroup.accountGroupId} />}
          <span className="col-start-2 flex h-11 min-w-0 flex-col justify-center px-1">
            <span className="truncate text-xs leading-4 font-medium text-muted-foreground">{sourceName}</span>
            <span className="flex h-6 min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate">{name}</span>
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
  onSelect(accountGroupId: AccountGroupId): void;
}) {
  if (group.type === "private-key") {
    return <AccountSwitchItem accountGroup={group.accountGroup} disabled={disabled} onSelect={onSelect} />;
  }

  return (
    <DropdownMenuGroup aria-label={group.source.name}>
      <div className="flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="truncate">{group.source.name}</span>
      </div>
      {group.accountGroups.map((accountGroup) => (
        <AccountSwitchItem
          key={accountGroup.accountGroupId}
          accountGroup={accountGroup}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </DropdownMenuGroup>
  );
}

function AccountSwitchItem({
  accountGroup,
  disabled,
  onSelect,
}: {
  accountGroup: AccountGroup;
  disabled: boolean;
  onSelect(accountGroupId: AccountGroupId): void;
}) {
  const { t } = useTranslation("wallet");
  const accountName = getAccountName(accountGroup, t);

  return (
    <DropdownMenuRadioItem
      value={accountGroup.accountGroupId}
      textValue={accountName}
      disabled={disabled}
      className="h-14 gap-3 rounded-none px-4 pr-11 text-sm font-semibold [&>span:first-child]:right-4 [&>span:first-child]:size-4"
      onSelect={(event) => {
        event.preventDefault();
        onSelect(accountGroup.accountGroupId);
      }}
    >
      <AccountIdenticon seed={accountGroup.accountGroupId} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{accountName}</span>
          {accountGroup.source.type === "private-key" && (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-xs font-medium text-muted-foreground">
              {t("privateKey")}
            </span>
          )}
        </span>
        <span className="min-h-4 text-xs leading-4 font-normal text-muted-foreground">
          {accountGroup.accounts.map((account) => {
            const { CompactAddress } = getNamespaceUi(account.namespace);
            return <CompactAddress key={account.accountId} address={account.defaultAddress} />;
          })}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
}
