import type { Address } from "@arx/core/accounts";
import { cn } from "cn";
import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNamespaceUi } from "@/ui/namespaces";
import { Button } from "../ui/button";
import { InputGroup } from "../ui/input-group";

export function PrivateKeyInput({
  disabled,
  className,
  surface = "onboarding",
  ...props
}: ComponentProps<"textarea"> & { surface?: "popup" | "onboarding" }) {
  const { t } = useTranslation(["onboarding", "common"]);
  const [visible, setVisible] = useState(false);
  const popup = surface === "popup";

  return (
    <InputGroup className={cn("h-24 items-start gap-2 py-2.5", popup ? "bg-card pr-2 pl-3.5" : "pr-2.5 pl-3")}>
      <textarea
        {...props}
        data-slot="input-group-control"
        rows={3}
        dir="ltr"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        className={cn(
          "h-full min-w-0 flex-1 resize-none bg-transparent font-mono text-sm outline-none disabled:cursor-not-allowed",
          popup ? "leading-normal" : "leading-relaxed",
          !visible && "[-webkit-text-security:disc]",
          className,
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("shrink-0 text-muted-foreground disabled:opacity-100", popup ? "size-7 rounded-md" : "size-6")}
        aria-label={t(visible ? "common:hidePassword" : "common:showPassword", { field: t("privateKey") })}
        onClick={() => setVisible(!visible)}
        disabled={disabled}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </InputGroup>
  );
}

export function PrivateKeyAddressPreview({
  addresses,
  className,
}: {
  addresses: readonly Address[];
  className?: string;
}) {
  const { t } = useTranslation(["onboarding", "common"]);

  return (
    <section
      aria-label={t("privateKeyAddress")}
      className={cn("flex flex-col gap-3 rounded-lg bg-background p-4", className)}
    >
      <h2 className="text-xs font-medium text-muted-foreground">{t("privateKeyAddress")}</h2>
      {addresses.map((address) => {
        const { Icon, labelKey, privateKeyImport } = getNamespaceUi(address.namespace);
        const { GroupedAddress } = privateKeyImport;
        return (
          <div key={address.address} className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Icon />
              <span className="text-sm font-semibold">{t(labelKey)}</span>
            </div>
            <GroupedAddress address={address.address} />
          </div>
        );
      })}
    </section>
  );
}
