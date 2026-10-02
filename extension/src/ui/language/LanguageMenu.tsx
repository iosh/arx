import { ChevronDown, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { UI_LANGUAGES, type UiLanguage } from "./languages";
import { UI_LANGUAGE_STORAGE_KEY } from "./preferences";

const languageNames: Record<UiLanguage, string> = { en: "English", "zh-CN": "简体中文" };

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  function selectLanguage(language: UiLanguage) {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
    void i18n.changeLanguage(language);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground has-[>svg]:px-2.5"
          aria-label={t("language")}
        >
          <Globe aria-hidden="true" />
          {languageNames[i18n.resolvedLanguage as UiLanguage]}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-45">
        <DropdownMenuRadioGroup value={i18n.resolvedLanguage}>
          {UI_LANGUAGES.map((language) => (
            <DropdownMenuRadioItem
              key={language}
              value={language}
              onSelect={() => selectLanguage(language)}
              lang={language}
            >
              {languageNames[language]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
