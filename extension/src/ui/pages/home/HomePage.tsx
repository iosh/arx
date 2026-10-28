import { Portal as DropdownMenuPortal } from "@radix-ui/react-dropdown-menu";
import { useRouter } from "@tanstack/react-router";
import { ChevronRight, Ellipsis, Lock, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { useSelectedAccount } from "@/ui/wallet/accounts/useSelectedAccount";
import { usePendingMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";
import { useLockWallet } from "@/ui/wallet/useWalletMutations";
import { AccountSwitcher } from "./AccountSwitcher";

export function HomePage() {
  const router = useRouter();
  const { t } = useTranslation("wallet");
  const { data: account, isPending: selectedAccountPending } = useSelectedAccount();
  const { data: source } = usePendingMnemonicSource(account);
  const [menuOpen, setMenuOpen] = useState(false);
  const { mutate: lockWallet, isPending: isLocking } = useLockWallet();

  const name = account ? getAccountName(account, t) : null;

  return (
    <main className="flex h-full flex-col gap-2.5 px-3.5 font-sans">
      <title>{name ? `${name} · ARX` : "ARX"}</title>
      <header className="flex h-14 shrink-0 items-center gap-2 px-1.5 py-1">
        <AccountSwitcher selectedAccount={account} selectedAccountPending={selectedAccountPending} />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7.5 rounded-md text-muted-foreground"
              aria-label={t("moreMenu")}
              disabled={isLocking}
            >
              <Ellipsis aria-hidden="true" className="size-4.5" />
            </Button>
          </DropdownMenuTrigger>
          {menuOpen && (
            <DropdownMenuPortal>
              <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 bg-overlay" />
            </DropdownMenuPortal>
          )}
          <DropdownMenuContent
            align="end"
            sideOffset={7}
            alignOffset={-6}
            className="w-50 rounded-2xl border-0 bg-card p-1 text-card-foreground"
          >
            <DropdownMenuItem className="h-11 gap-2.5 px-3 text-sm font-medium" onSelect={() => lockWallet()}>
              <Lock aria-hidden="true" />
              {t("lockWallet")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <section className="overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_var(--shadow)]">
        <div aria-hidden="true" className="h-35.5" />
        {source && (
          <a
            href={`${browser.runtime.getURL("/onboarding.html")}#${
              router.buildLocation({
                to: "/onboarding/backup-mnemonic/$keySourceId",
                params: { keySourceId: source.keySourceId },
              }).href
            }`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-10 items-center gap-2 bg-warning-subtle px-4 py-2.5 text-xs font-semibold text-warning-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 wrap-anywhere">{t("backupNotice", { walletName: source.name })}</span>
            <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-warning" />
          </a>
        )}
      </section>
    </main>
  );
}
