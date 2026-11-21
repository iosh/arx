import type { ChainRef, Network } from "@arx/core/networks";
import { Portal } from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";

export function HomeNetworkFilter({
  networks,
  selectedNetwork,
  onSelect,
}: {
  networks: readonly Network[];
  selectedNetwork?: Network;
  onSelect(chainRef: ChainRef | null): void;
}) {
  const { t } = useTranslation("wallet");
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`h-7 max-w-48 gap-1.5 rounded-full px-3 text-xs font-medium ${selectedNetwork ? "bg-brand-subtle text-brand" : "bg-card"}`}
          aria-label={t("filterNetworks")}
        >
          <span className="min-w-0 truncate">{selectedNetwork?.name ?? t("allNetworks")}</span>
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      {open && (
        <Portal>
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 bg-overlay" />
        </Portal>
      )}
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={14}
        className="w-65 rounded-2xl border-0 bg-card p-1"
      >
        <DropdownMenuRadioGroup
          value={selectedNetwork?.chainRef ?? "all"}
          onValueChange={(value) => onSelect(value === "all" ? null : value)}
        >
          <DropdownMenuRadioItem value="all" className="min-h-11 px-3 pr-8">
            {t("allNetworks")}
          </DropdownMenuRadioItem>
          {networks.map((network) => (
            <DropdownMenuRadioItem key={network.chainRef} value={network.chainRef} className="min-h-11 gap-2 px-3 pr-8">
              <span className="min-w-0 flex-1 truncate" title={network.name}>
                {network.name}
              </span>
              {network.isTestnet && (
                <span className="shrink-0 rounded bg-secondary px-1 text-[10px] leading-4 text-muted-foreground">
                  {t("testnet")}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
