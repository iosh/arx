import { type ComponentProps, useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup, InputGroupInput } from "@/ui/components/ui/input-group";

export function NetworkFormInput({
  label,
  description,
  error,
  ...props
}: ComponentProps<typeof InputGroupInput> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const message = error ?? description;
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id} className="px-1 text-sm text-muted-foreground">
        {label}
      </FieldLabel>
      <InputGroup className="bg-card">
        <InputGroupInput
          autoComplete="off"
          {...props}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={message ? `${id}-help` : undefined}
        />
      </InputGroup>
      {message && (
        <FieldDescription
          id={`${id}-help`}
          aria-live="polite"
          className={`px-1 ${error ? "text-destructive-foreground" : ""}`}
        >
          {message}
        </FieldDescription>
      )}
    </Field>
  );
}
