import { cn } from "cn";
import type { ComponentProps } from "react";

function Field({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field" className={cn("flex w-full flex-col gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, htmlFor, children, ...props }: ComponentProps<"label">) {
  return (
    <label htmlFor={htmlFor} data-slot="field-label" className={cn("text-sm font-medium", className)} {...props}>
      {children}
    </label>
  );
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("min-h-4 text-xs leading-4 text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldLabel };
