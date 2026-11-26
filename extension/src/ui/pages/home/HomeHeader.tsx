import type { AccountGroup } from "@arx/core/accounts";
import { Portal } from "@radix-ui/react-dropdown-menu";
import { Link } from "@tanstack/react-router";
import { Ellipsis, Lock, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { useLockWallet } from "@/ui/wallet/useWalletMutations";
import { AccountSwitcher } from "./AccountSwitcher";

export function HomeHeader({ accountGroup }: { accountGroup: AccountGroup | undefined }) {
  const { t } = useTranslation("wallet");
  const [menuOpen, setMenuOpen] = useState(false);
  const { mutate: lockWallet, isPending: isLocking } = useLockWallet();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-1.5 py-1">
      <AccountSwitcher selectedGroup={accountGroup} />
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
          <Portal>
            <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 bg-overlay" />
          </Portal>
        )}
        <DropdownMenuContent
          align="end"
          sideOffset={7}
          alignOffset={-6}
          className="w-50 rounded-2xl border-0 bg-card p-1 text-card-foreground"
        >
          <DropdownMenuItem asChild className="h-11 gap-2.5 px-3 text-sm font-medium">
            <Link to="/wallet/settings">
              <Settings aria-hidden="true" />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="h-11 gap-2.5 px-3 text-sm font-medium" onSelect={() => lockWallet()}>
            <Lock aria-hidden="true" />
            {t("lockWallet")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
