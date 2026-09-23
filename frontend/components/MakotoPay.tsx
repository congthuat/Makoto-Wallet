"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { ServiceComingSoonDialog } from "./ServiceComingSoonDialog";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./MakotoPay.module.css";
import walletStyles from "./MakotoWallet.module.css";
import { PAY_SERVICE_ART, PAY_SERVICE_IDS, POPULAR_PAY_SERVICE_IDS, type PayServiceId } from "@/lib/makotoPayCatalog";

export function MakotoPay() {
  const { t } = usePreferences();
  const [comingSoon, setComingSoon] = useState<string>();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  function openComingSoon(service: string, button: HTMLButtonElement) { openerRef.current = button; setComingSoon(service); }
  function closeComingSoon() { setComingSoon(undefined); window.setTimeout(() => openerRef.current?.focus(), 0); }

  return <main className={`${walletStyles.page} ${styles.page}`} data-pay-state="prototype"><div className={styles.shell}>
    <AppHeader />
    <section className={styles.hero} aria-labelledby="pay-title" data-pay-state="prototype"><div>
      <span className={styles.badge}>{t("pay.badge")}</span><p className={styles.eyebrow}>MAKOTO PAY</p>
      <h1 id="pay-title">{t("pay.heroTitle")}</h1><p className={styles.heroCopy}>{t("pay.heroCopy")}</p>
    </div></section>
    <aside className={styles.notice} aria-label={t("pay.prototypeNoticeTitle")} role="note"><strong>{t("pay.prototypeNoticeTitle")}</strong><span>{t("pay.prototypeNotice")}</span></aside>
    <ServiceSection title={t("pay.popular")} entries={POPULAR_PAY_SERVICE_IDS} t={t} onComingSoon={openComingSoon} featured />
    <ServiceSection title={t("pay.allServices")} entries={PAY_SERVICE_IDS} t={t} onComingSoon={openComingSoon} />
  </div>{comingSoon && <ServiceComingSoonDialog service={comingSoon} onClose={closeComingSoon} />}</main>;
}

function ServiceSection({ title, entries, t, onComingSoon, featured = false }: { title: string; entries: readonly PayServiceId[]; t: ReturnType<typeof usePreferences>["t"]; onComingSoon(service: string, button: HTMLButtonElement): void; featured?: boolean }) {
  return <section className={styles.catalog} aria-labelledby={`services-${featured ? "popular" : "all"}`}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>MAKOTO PAY</p><h2 id={`services-${featured ? "popular" : "all"}`}>{title}</h2></div><span>{featured ? t("pay.popularHint") : t("pay.catalogHint")}</span></div><div className={`${styles.serviceGrid} ${featured ? styles.popularGrid : ""}`}>{entries.map((id) => {
    const demo = id === "mobile"; const name = t(`pay.service.${id}` as Parameters<typeof t>[0]);
    const description = t(`pay.service.${id}.description` as Parameters<typeof t>[0]);
    return demo ? <Link key={id} href="/pay/mobile-topup" title={description} className={`${styles.serviceCard} ${styles.demoCard}`} data-service-state="demo"><ServiceCardContent art={PAY_SERVICE_ART[id]} name={name} description={featured ? description : undefined} status={t("pay.demoAvailable")} /></Link>
      : <button key={id} type="button" title={description} className={styles.serviceCard} data-service-state="planned" onClick={(event) => onComingSoon(name, event.currentTarget)}><ServiceCardContent art={PAY_SERVICE_ART[id]} name={name} description={featured ? description : undefined} status={t("pay.comingSoon")} /></button>;
  })}</div></section>;
}

function ServiceCardContent({ art, name, description, status }: { art: string; name: string; description?: string; status: string }) { return <><span className={styles.serviceIcon}><Image src={art} alt="" width={86} height={86} /></span><span className={styles.serviceText}><strong>{name}</strong>{description && <small>{description}</small>}</span><span className={styles.status}>{status}</span></>; }
