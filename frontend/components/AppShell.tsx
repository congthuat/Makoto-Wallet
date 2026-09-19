"use client";

import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./AppShell.module.css";

/** Presentation only: providers and all route-owned controllers stay in place. */
export function AppShell({ children, legacyClassName }: { children: ReactNode; legacyClassName?: string }) {
  const { locale } = usePreferences();
  return <div className={`${styles.page} ${legacyClassName ?? ""}`.trim()}>
    <a className={styles.skipLink} href="#main-content">{locale === "vi" ? "Đến nội dung chính" : "Skip to main content"}</a>
    <AppHeader />
    <main id="main-content" className={styles.content} tabIndex={-1}>{children}</main>
  </div>;
}
