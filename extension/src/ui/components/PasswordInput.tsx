import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { TextField, type TextFieldProps } from "./TextField";

export type PasswordRevealMode = "toggle" | "press";

export type PasswordInputProps = Omit<TextFieldProps, "secureTextEntry" | "endAdornment"> & {
  revealMode?: PasswordRevealMode;
};

function stopFormSubmit(e: unknown) {
  if (e && typeof e === "object") {
    const maybe = e as { preventDefault?: () => void; stopPropagation?: () => void };
    maybe.preventDefault?.();
    maybe.stopPropagation?.();
  }
}

export function PasswordInput({ revealMode = "toggle", disabled, ...props }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (disabled) setRevealed(false);
  }, [disabled]);

  const label = revealed ? "Hide password" : "Show password";

  const endAdornment = (
    <Button
      variant="ghost"
      circular
      size="$2"
      disabled={disabled}
      aria-label={label}
      aria-pressed={revealMode === "toggle" ? revealed : undefined}
      icon={revealed ? <EyeOff size={18} /> : <Eye size={18} />}
      onPress={
        disabled
          ? undefined
          : (e) => {
              stopFormSubmit(e);
              if (revealMode === "toggle") setRevealed((v) => !v);
            }
      }
      onPressIn={
        disabled
          ? undefined
          : (e) => {
              stopFormSubmit(e);
              if (revealMode === "press") setRevealed(true);
            }
      }
      onPressOut={
        disabled
          ? undefined
          : (e) => {
              stopFormSubmit(e);
              if (revealMode === "press") setRevealed(false);
            }
      }
      hoverStyle={{ backgroundColor: "$surface" }}
      pressStyle={{ backgroundColor: "$surface", opacity: 0.85 }}
    />
  );

  return <TextField {...props} disabled={disabled} secureTextEntry={!revealed} endAdornment={endAdornment} />;
}
