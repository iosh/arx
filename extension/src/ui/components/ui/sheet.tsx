import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "cn";
import type { ComponentProps } from "react";

function SheetContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-1rem)] flex-col gap-3 overflow-y-auto rounded-t-[20px] bg-card px-3.5 pt-2 pb-4.5 text-card-foreground outline-none",
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

function SheetDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("px-1 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Close as SheetClose, Root as Sheet, Trigger as SheetTrigger } from "@radix-ui/react-dialog";
export { SheetContent, SheetDescription, SheetTitle };
