import type { Account } from "@arx/core/accounts";
import { KeyRound, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { Button } from "@/ui/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/ui/components/ui/sheet";
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";
import { getNamespaceUi } from "@/ui/namespaces";
import { useAccountAddresses } from "@/ui/wallet/accounts/useAccountAddresses";

export function ConfirmAccountMoveSheet({
  account,
  walletName,
  description,
  className,
  isPending,
  onCancel,
  onConfirm,
  returnFocusRef,
}: {
  account: Account;
  walletName: string;
  description?: string;
  className?: string;
  isPending: boolean;
  onCancel(): void;
  onConfirm(): void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation(["wallet", "common"]);
  const accountName = getAccountName(account, t);
  const { labelKey } = getNamespaceUi(account.namespace);
  const {
    networkSelection: { isPending: networkPending },
    addresses: { data: addresses, isFetching: addressesFetching },
  } = useAccountAddresses(account);
  const loadingAddress = networkPending || addressesFetching;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <SheetContent
        className={className}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        aria-busy={isPending}
      >
        <div className="flex h-11 shrink-0 items-center justify-between pr-0.5 pl-1">
          <SheetTitle>{t("accountAlreadyExists")}</SheetTitle>
          <SheetClose asChild>
            <Button
              variant="secondary"
              size="icon-sm"
              className="size-7.5 rounded-full text-muted-foreground"
              aria-label={t("common:close")}
              disabled={isPending}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </SheetClose>
        </div>
        <SheetDescription className="text-sm font-normal text-foreground wrap-anywhere">
          {description ?? t("accountMoveDescription", { accountName, walletName })}
        </SheetDescription>
        <div className="flex flex-col gap-2.5 rounded-xl bg-secondary p-3">
          <div className="flex items-center gap-2.5">
            <AccountIdenticon accountId={account.accountId} size={32} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold wrap-anywhere">{accountName}</span>
              <span className="text-xs font-medium text-muted-foreground">{`${t(labelKey)} · ${t("privateKeyImport")}`}</span>
            </div>
          </div>
          {addresses ? (
            addresses.map((address) => (
              <p key={address.address} dir="ltr" className="break-all text-xs leading-4.5">
                {address.address}
              </p>
            ))
          ) : loadingAddress ? (
            <div className="text-xs text-muted-foreground">
              <Spinner aria-label={t("loadingAddress")} />
            </div>
          ) : null}
        </div>
        <div className="flex items-start gap-2 px-1 text-sm">
          <span className="shrink-0 font-medium text-muted-foreground">{t("moveTargetWallet")}</span>
          <KeyRound aria-hidden="true" className="mt-0.5 ml-auto size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-right font-semibold wrap-anywhere">{walletName}</span>
        </div>
        <p className="px-1 text-xs font-medium text-muted-foreground wrap-anywhere">
          {t("accountMoveScope", { walletName })}
        </p>
        <div className="flex gap-2.5">
          <Button variant="outline" className="flex-1" disabled={isPending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button className="flex-1" disabled={isPending || !addresses} onClick={onConfirm}>
            {isPending && <Spinner aria-label={t("moveAccount")} />}
            {t("moveAccount")}
          </Button>
        </div>
        <div className="absolute">
          <Toaster id="account-move" position="top-center" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
