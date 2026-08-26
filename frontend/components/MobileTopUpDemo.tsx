"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { AppHeader } from "./AppHeader";
import { usePreferences } from "@/hooks/usePreferences";
import { createDemoOrderId, DEMO_CARRIERS, demoUsdcForVnd, isValidVietnamDemoPhone, maskVietnamPhone, normalizeVietnamPhone, TOP_UP_DENOMINATIONS, type DemoCarrier } from "@/lib/makotoPay";
import styles from "./MakotoPay.module.css";
import walletStyles from "./MakotoWallet.module.css";

type Step = "entry" | "review" | "complete";

export function MobileTopUpDemo() {
  const { locale, t } = usePreferences();
  const [carrier, setCarrier] = useState<DemoCarrier>();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<number>();
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<Step>("entry");
  const [orderId, setOrderId] = useState("");
  const validPhone = isValidVietnamDemoPhone(phone);
  const canReview = Boolean(carrier && validPhone && amount);
  const usdc = useMemo(() => amount ? demoUsdcForVnd(amount) : undefined, [amount]);
  const vnd = (value: number) => new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(value);

  function complete() { setOrderId(createDemoOrderId()); setStep("complete"); }
  function reset() { setCarrier(undefined); setPhone(""); setAmount(undefined); setTouched(false); setOrderId(""); setStep("entry"); }

  return <main className={`${walletStyles.page} ${styles.page}`}><div className={styles.shell}><AppHeader />
    <div className={styles.topupBack}><Link href="/pay">← {t("pay.backToPay")}</Link></div>
    <section className={styles.topupHero}><div><span className={styles.badge}>{t("pay.productDemo")}</span><p className={styles.eyebrow}>MAKOTO PAY</p><h1>{t("pay.topup.title")}</h1><p>{t("pay.topup.subtitle")}</p></div><Image src="/makoto/pay/mobile-topup.svg" alt="" width={150} height={150} loading="eager" /></section>
    {step === "entry" && <section className={styles.flowCard} aria-labelledby="topup-entry-title"><h2 id="topup-entry-title">{t("pay.topup.details")}</h2>
      <fieldset><legend><span>1</span>{t("pay.topup.chooseCarrier")}</legend><div className={styles.carrierGrid}>{DEMO_CARRIERS.map((name) => <button key={name} type="button" className={carrier === name ? styles.selected : undefined} aria-pressed={carrier === name} onClick={() => setCarrier(name)}>{name}</button>)}</div><p className={styles.secondary}>{t("pay.topup.carrierDisclosure")}</p></fieldset>
      <label className={styles.phoneField}><span><b>2</b>{t("pay.topup.phone")}</span><input id="mobile-topup-phone" name="phone" inputMode="numeric" autoComplete="off" value={phone} placeholder="0912 345 678" aria-describedby="phone-help phone-error" aria-invalid={touched && !validPhone} onBlur={() => setTouched(true)} onChange={(event) => { if (/^[\d\s]*$/.test(event.target.value)) setPhone(event.target.value); }} /><small id="phone-help">{t("pay.topup.phoneHelp")}</small>{touched && !validPhone && <em id="phone-error" role="alert">{t("pay.topup.phoneError")}</em>}</label>
      <fieldset><legend><span>3</span>{t("pay.topup.chooseAmount")}</legend><div className={styles.amountGrid}>{TOP_UP_DENOMINATIONS.map((value) => <button key={value} type="button" className={amount === value ? styles.selected : undefined} aria-pressed={amount === value} onClick={() => setAmount(value)}>{vnd(value)} ₫<small>{demoUsdcForVnd(value)} USDC</small></button>)}</div></fieldset>
      <div className={styles.fxBox}><div><strong>{t("pay.topup.demoFx")}</strong><span>1 USDC = {vnd(25_000)} VND</span></div><small>{t("pay.topup.fxDisclosure")}</small></div>
      <dl className={styles.summary}><Row label={t("pay.topup.value")} value={amount ? `${vnd(amount)} VND` : "—"} /><Row label={t("pay.topup.estimated")} value={usdc ? `${usdc} USDC` : "—"} /><Row label={t("pay.topup.network")} value="Arc Testnet" /><Row label={t("pay.topup.fulfillment")} value={t("pay.topup.simulated")} /></dl>
      <button className={styles.primary} type="button" disabled={!canReview} onClick={() => setStep("review")}>{t("pay.topup.reviewCta")}</button>
    </section>}
    {step === "review" && carrier && amount && usdc && <section className={styles.flowCard} aria-labelledby="topup-review-title"><p className={styles.eyebrow}>{t("pay.topup.safetyReview")}</p><h2 id="topup-review-title">{t("pay.topup.reviewTitle")}</h2><dl className={styles.reviewList}><Row label={t("pay.topup.service")} value={t("pay.service.mobile")} /><Row label={t("pay.topup.carrier")} value={carrier} /><Row label={t("pay.topup.phone")} value={maskVietnamPhone(normalizeVietnamPhone(phone))} /><Row label={t("pay.topup.value")} value={`${vnd(amount)} VND`} /><Row label={t("pay.topup.usdcAmount")} value={`${usdc} USDC`} /><Row label={t("pay.topup.demoFx")} value={`1 USDC = ${vnd(25_000)} VND`} /><Row label={t("pay.topup.networkConcept")} value="Arc Testnet" /><Row label={t("pay.topup.fulfillment")} value={t("pay.topup.simulated")} /></dl><div className={styles.demoWarning}><strong>{t("pay.topup.demoOnly")}</strong><p>{t("pay.topup.noTransaction")}</p></div><div className={styles.actions}><button type="button" onClick={() => setStep("entry")}>{t("common.back")}</button><button className={styles.primary} type="button" onClick={complete}>{t("pay.topup.completeDemo")}</button></div></section>}
    {step === "complete" && amount && usdc && <section className={`${styles.flowCard} ${styles.complete}`} role="status" aria-live="polite"><span className={styles.completeIcon} aria-hidden="true">✓</span><p className={styles.eyebrow}>MAKOTO PAY</p><h2>{t("pay.topup.completed")}</h2><strong className={styles.completeAmount}>{vnd(amount)} VND</strong><dl className={styles.reviewList}><Row label={t("pay.topup.estimated")} value={`${usdc} USDC`} /><Row label={t("pay.topup.status")} value={t("pay.topup.simulationComplete")} /><Row label={t("pay.topup.serviceDelivery")} value={t("pay.topup.notSent")} /><Row label={t("pay.topup.blockchainTransaction")} value={t("pay.topup.notSubmitted")} /><Row label={t("pay.topup.orderId")} value={orderId} /></dl><div className={styles.actions}><button type="button" onClick={reset}>{t("pay.topup.tryAnother")}</button><Link className={styles.primary} href="/pay">{t("pay.backToPay")}</Link></div></section>}
  </div></main>;
}

function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
