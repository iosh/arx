import { cn } from "cn";
import type { ComponentProps } from "react";
import { Input } from "./input";

function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "group/input-group flex h-12 w-full min-w-0 items-center rounded-xl border border-input bg-background transition-[color,box-shadow] outline-none",
        "has-[>[data-align=inline-start]]:[&>input]:pl-1.5 has-[>[data-align=inline-end]]:[&>input]:pr-1.5",
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50",
        "has-[[data-slot=input-group-control][aria-invalid=true]]:border-destructive has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive/40",
        "has-[[data-slot=input-group-control]:disabled]:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: ComponentProps<"div"> & { align?: "inline-start" | "inline-end" }) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex shrink-0 items-center justify-center text-muted-foreground",
        align === "inline-start" ? "order-first pl-1.5" : "order-last pr-1.5",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "h-full flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 disabled:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupInput };
