import { Check, CircleAlert, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  const { t } = useTranslation("common");

  return (
    <Sonner
      position="bottom-center"
      duration={3_000}
      visibleToasts={1}
      offset={14}
      mobileOffset={14}
      customAriaLabel={t("notifications")}
      style={{ "--width": "min(372px, calc(100vw - 28px))" } as CSSProperties}
      icons={{
        success: <Check aria-hidden="true" className="size-3.75" />,
        error: <CircleAlert aria-hidden="true" className="size-4 text-destructive-foreground" />,
        close: <X aria-hidden="true" className="size-4" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t("close"),
        classNames: {
          toast:
            "flex w-full items-center gap-1.75 rounded-[10px] px-4 py-3 font-sans text-xs leading-4 font-semibold focus-visible:ring-2 focus-visible:ring-ring",
          success: "bg-foreground text-card",
          error: "border border-border bg-popover text-popover-foreground shadow-[0_2px_12px_var(--shadow)]",
          content: "min-w-0 flex-1 wrap-anywhere",
          icon: "shrink-0",
          closeButton:
            "order-last flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        },
      }}
      {...props}
    />
  );
}
