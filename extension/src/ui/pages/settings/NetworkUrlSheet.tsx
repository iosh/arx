import {
  NetworkBlockExplorerExistsError,
  NetworkConfigurationChangedError,
  type NetworkUrlUpdate,
} from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { Sheet, SheetContent } from "@/ui/components/ui/sheet";
import { Toaster } from "@/ui/components/ui/sonner";
import { Spinner } from "@/ui/components/ui/spinner";
import { isHttpUrl } from "@/ui/utils/url";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { NetworkFormInput } from "./NetworkFormInput";
import { NetworkSheetHeader } from "./NetworkSheetHeader";
import { getNetworkRpcError } from "./networkRpcError";

export type NetworkUrlTarget = Readonly<{ index: number; url: string }>;

export function NetworkUrlSheet({
  title,
  label,
  networkName,
  requiredMessage,
  target,
  onSave,
  onCloseAutoFocus,
  onClose,
}: {
  title: string;
  label: string;
  networkName: string;
  requiredMessage: string;
  target: NetworkUrlTarget | null;
  onSave(update: NetworkUrlUpdate): Promise<void>;
  onCloseAutoFocus(event: Event): void;
  onClose(): void;
}) {
  const { t } = useTranslation("wallet");
  const reportError = useWalletError();
  const toasterId = useId();
  const saving = useWalletMutation({
    mutationFn: onSave,
    gcTime: 0,
  });
  const {
    register,
    handleSubmit,
    setFocus,
    setError,
    clearErrors,
    formState: { errors, dirtyFields, isValid },
  } = useForm({ defaultValues: { url: target?.url ?? "" }, mode: "onChange" });

  return (
    <Sheet
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving.isPending) onClose();
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setFocus("url", { shouldSelect: true });
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <NetworkSheetHeader title={title} pending={saving.isPending} />
        <form
          noValidate
          aria-busy={saving.isPending}
          className="flex flex-col gap-3 [&_label]:text-xs **:data-[slot=field]:gap-1.5"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          onSubmit={handleSubmit((values) => {
            const url = values.url.trim();
            if (!dirtyFields.url || url === target?.url) {
              onClose();
              return;
            }
            saving.mutate(
              target ? { type: "replace", index: target.index, expectedUrl: target.url, url } : { type: "add", url },
              {
                onSuccess: () => {
                  onClose();
                },
                onError: (error) => {
                  const rpcError = getNetworkRpcError(error, networkName, t);
                  const message =
                    rpcError?.message ??
                    (isWalletApiError(error, NetworkConfigurationChangedError)
                      ? t("networkConfigurationChanged")
                      : isWalletApiError(error, NetworkBlockExplorerExistsError)
                        ? t("blockExplorerAlreadyExists")
                        : undefined);
                  if (message) setError("url", { type: "network", message }, { shouldFocus: true });
                  else reportError(error, toasterId);
                },
              },
            );
          })}
        >
          <NetworkFormInput
            {...register("url", {
              validate: (value) => {
                const text = value.trim();
                if (!text) return requiredMessage;
                return isHttpUrl(text) || t("rpcUrlInvalid");
              },
              onChange: () => clearErrors("url"),
            })}
            label={label}
            error={errors.url?.message}
            type="url"
            dir="ltr"
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            readOnly={saving.isPending}
            className="text-sm"
          />
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
