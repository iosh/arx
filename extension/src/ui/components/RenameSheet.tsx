import { ChevronRight, CircleX, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/components/ui/input-group";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/ui/components/ui/sheet";
import { Toaster } from "@/ui/components/ui/sonner";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export function RenameSheet({
  label,
  name,
  disabled = false,
  onRename,
}: {
  label: string;
  name?: string;
  disabled?: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const toasterId = useId();
  const saving = useWalletMutation({ mutationFn: onRename, toasterId, gcTime: 0 });

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (saving.isPending) return;
        if (nextOpen) toast.dismiss();
        setOpen(nextOpen);
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          disabled={disabled || saving.isPending}
          className="flex h-12 w-full items-center gap-2 px-4 text-sm outline-none enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="shrink-0 font-medium">{label}</span>
          <span className="ml-auto truncate text-muted-foreground">{name}</span>
          <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
        </button>
      </SheetTrigger>
      {open && name !== undefined && (
        <RenameForm
          label={label}
          name={name}
          pending={saving.isPending}
          toasterId={toasterId}
          onClose={() => setOpen(false)}
          onSave={(nextName) => saving.mutate(nextName, { onSuccess: () => setOpen(false) })}
        />
      )}
    </Sheet>
  );
}

function RenameForm({
  label,
  name,
  pending,
  toasterId,
  onSave,
  onClose,
}: {
  label: string;
  name: string;
  pending: boolean;
  toasterId: string;
  onSave(name: string): void;
  onClose(): void;
}) {
  const { t } = useTranslation("wallet");
  const errorId = useId();
  const {
    register,
    handleSubmit,
    setFocus,
    setValue,
    formState: { errors, dirtyFields, isValid },
  } = useForm({ defaultValues: { name }, mode: "onChange" });

  function submit({ name: inputName }: { name: string }) {
    const nextName = inputName.trim();
    if (!dirtyFields.name || nextName === name) {
      onClose();
      return;
    }
    onSave(nextName);
  }

  return (
    <SheetContent
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        setFocus("name", { shouldSelect: true });
      }}
    >
      <div className="flex h-11 shrink-0 items-center justify-between pr-0.5 pl-1">
        <SheetTitle>{label}</SheetTitle>
        <SheetClose asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="size-7.5 rounded-full text-muted-foreground"
            aria-label={t("closeRename")}
            disabled={pending}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </SheetClose>
      </div>
      <form onSubmit={handleSubmit(submit)} aria-busy={pending} className="flex flex-col gap-3">
        <InputGroup className="h-11 bg-card">
          <InputGroupInput
            {...register("name", { validate: (value) => value.trim().length > 0 })}
            aria-label={label}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? errorId : undefined}
            autoComplete="off"
            className="px-3.5 font-semibold"
            disabled={pending}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
            }}
          />
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-placeholder"
              aria-label={t("clearName")}
              disabled={pending}
              onClick={() => {
                setValue("name", "", { shouldDirty: true, shouldValidate: true });
                setFocus("name");
              }}
            >
              <CircleX aria-hidden="true" className="size-4" />
            </Button>
          </InputGroupAddon>
        </InputGroup>
        {errors.name && (
          <p id={errorId} className="px-1 text-xs text-destructive-foreground" aria-live="polite">
            {t("nameRequired")}
          </p>
        )}
        <SheetDescription>{t("namePrivacy")}</SheetDescription>
        <Button type="submit" className="w-full" disabled={!isValid || pending} aria-busy={pending}>
          {t("saveName")}
        </Button>
      </form>
      <div className="absolute">
        <Toaster id={toasterId} position="top-center" />
      </div>
    </SheetContent>
  );
}
