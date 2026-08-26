"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./MakotoWallet.module.css";

export function LanguageMenu({ icon }: { icon?: ReactNode }) {
  const { locale, setLocale, t } = usePreferences();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  return (
    <div className={styles.languageMenu} ref={root}>
      <button type="button" className={styles.languageTrigger} aria-label={`${t("preferences.language")} (${locale.toUpperCase()})`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {icon}
        <strong>{locale.toUpperCase()}</strong>
        <svg className={styles.languageChevron} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open && (
        <div className={styles.languageDropdown} role="menu" aria-label={t("preferences.language")}>
          <p>{t("preferences.language")}</p>
          {(["en", "vi"] as const).map((option) => {
            const selected = locale === option;
            return (
              <button key={option} type="button" role="menuitemradio" aria-checked={selected} className={selected ? styles.languageActive : undefined} onClick={() => { setLocale(option); setOpen(false); }}>
                <span>{option === "en" ? t("preferences.english") : t("preferences.vietnamese")}</span>
                <span className={styles.languageCode}>{option.toUpperCase()}</span>
                <span className={styles.languageCheck} aria-hidden="true">{selected ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
