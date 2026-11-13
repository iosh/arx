import type { CustomNetworkUpdate, Network } from "@arx/core/networks";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/ui/components/ui/sheet";
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { updateNetworkCache } from "@/ui/wallet/networks/useNetworks";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { NetworkFormInput } from "./NetworkFormInput";
import { NetworkSheetHeader } from "./NetworkSheetHeader";

export function NetworkCurrencySheet({ network }: { network: Network }) {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const toasterId = useId();
  const saving = useWalletMutation({
    mutationFn: async (nativeCurrency: NonNullable<CustomNetworkUpdate["changes"]["nativeCurrency"]>) =>
      updateNetworkCache(
        queryClient,
        await wallet.networks.updateCustom({ chainRef: network.chainRef, changes: { nativeCurrency } }),
      ),
    toasterId,
    gcTime: 0,
  });
  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, dirtyFields, isValid },
  } = useForm({
    values: { symbol: network.nativeCurrency.symbol, decimals: String(network.nativeCurrency.decimals) },
    resetOptions: { keepDirtyValues: true },
    mode: "onChange",
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (saving.isPending) return;
        if (nextOpen) {
          toast.dismiss();
          reset({ symbol: network.nativeCurrency.symbol, decimals: String(network.nativeCurrency.decimals) });
        }
        setOpen(nextOpen);
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex h-12 w-full items-center gap-2 px-4 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="shrink-0 font-medium">{t("networkCurrency")}</span>
          <span className="ml-auto truncate text-muted-foreground">
            {t("networkCurrencyDetails", network.nativeCurrency)}
          </span>
          <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
        </button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setFocus("symbol", { shouldSelect: true });
        }}
      >
        <NetworkSheetHeader title={t("networkCurrency")} pending={saving.isPending} />
        <form
          noValidate
          aria-busy={saving.isPending}
          className="flex flex-col gap-3 [&_label]:text-xs **:data-[slot=field]:gap-1.5"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          onSubmit={handleSubmit((values) => {
            const symbol = values.symbol.trim();
            const decimals = Number(values.decimals);
            const symbolChanged = dirtyFields.symbol && symbol !== network.nativeCurrency.symbol;
            const decimalsChanged = dirtyFields.decimals && decimals !== network.nativeCurrency.decimals;
            if (!symbolChanged && !decimalsChanged) {
              setOpen(false);
              return;
            }
            saving.mutate(
              { ...(symbolChanged ? { symbol } : {}), ...(decimalsChanged ? { decimals } : {}) },
              { onSuccess: () => setOpen(false) },
            );
          })}
        >
          <div className="grid grid-cols-2 gap-3">
            <NetworkFormInput
              {...register("symbol", { validate: (value) => value.trim().length > 0 || t("currencySymbolRequired") })}
              label={t("nativeCurrencySymbol")}
              error={errors.symbol?.message}
              dir="ltr"
              spellCheck={false}
              readOnly={saving.isPending}
              className="text-sm"
            />
            <NetworkFormInput
              {...register("decimals", {
                validate: (value) =>
                  (value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0) ||
                  t("currencyDecimalsInvalid"),
              })}
              label={t("currencyDecimals")}
              error={errors.decimals?.message}
              type="number"
              min={0}
              step={1}
              dir="ltr"
              readOnly={saving.isPending}
              className="text-sm"
            />
          </div>
          <Button type="submit" className="w-full" disabled={!isValid || saving.isPending} aria-busy={saving.isPending}>
            {saving.isPending && <Spinner aria-label={t("savingNetwork")} />}
            {t("saveName")}
          </Button>
        </form>
        <div className="absolute">
          <Toaster id={toasterId} position="top-center" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
