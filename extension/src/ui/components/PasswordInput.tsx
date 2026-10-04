import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

export function PasswordInput({
  fieldLabel,
  groupClassName,
  disabled,
  ...props
}: Omit<ComponentProps<typeof InputGroupInput>, "type"> & { fieldLabel: string; groupClassName?: string }) {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  return (
    <InputGroup className={groupClassName}>
      <InputGroupInput
        spellCheck={false}
        autoCapitalize="none"
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
      />
      <InputGroupAddon align="inline-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="disabled:opacity-100"
          aria-label={t(visible ? "hidePassword" : "showPassword", { field: fieldLabel })}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
