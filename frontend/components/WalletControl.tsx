"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection, useDisconnect } from "wagmi";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useHydrated } from "@/hooks/useHydrated";
import { useWalletReadContext } from "@/hooks/useWalletAccount";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { formatUsdc, shortAddress } from "@/lib/format";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { usePreferences } from "@/hooks/usePreferences";
import { getAppKit, isReownConfigured } from "@/lib/wagmi";
import { appKitViewForPath, walletKindFromConnector } from "@/lib/onboarding";

export function WalletControl() {
  const hydrated = useHydrated();
  const connection = useConnection();
  const disconnect = useDisconnect();
  const wallet = useWalletReadContext();
  const verifiedChain = useVerifiedWalletChain();
  const { t } = usePreferences();
  const [accountOpen, setAccountOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [isMobileAccountSheet, setIsMobileAccountSheet] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const onArc = verifiedChain.isArc;
  const localWallet = wallet.kind === "local";
  const activeAddress = wallet.address ?? connection.address;
  const activeOnArc = localWallet ? wallet.isArc : onArc;
  const balances = useWalletBalances(activeAddress, !localWallet && connection.isConnected && onArc);
  const walletName = connection.connector?.name;
  const walletKind = walletKindFromConnector(connection.connector?.id);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const sync = () => setIsMobileAccountSheet(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!accountOpen || !isMobileAccountSheet) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, [accountOpen, isMobileAccountSheet]);

  useEffect(() => {
    if (!accountOpen) return;
    const focusFrame = window.requestAnimationFrame(() => panelCloseRef.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAccount(true);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!isMobileAccountSheet && !controlRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [accountOpen, isMobileAccountSheet]);

  function closeAccount(restoreTriggerFocus = false) {
    setAccountOpen(false);
    if (restoreTriggerFocus) window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  async function openWalletModal() {
    const appKit = getAppKit();
    if (!appKit) return;
    setMessage(undefined);
    await appKit.open({ view: appKitViewForPath("existing") });
  }

  async function switchToArc() {
    setMessage(undefined);
    await verifiedChain.switchToArc();
  }

  async function copyAddress() {
    if (!activeAddress) return;
    await navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (!hydrated || (!localWallet && connection.status !== "connected") || !activeAddress) {
    return <div className="wallet-control">
      <button
        className="connect-button"
        onClick={() => void openWalletModal()}
        disabled={!isReownConfigured}
        title={!isReownConfigured ? "Set NEXT_PUBLIC_REOWN_PROJECT_ID to enable wallet connections." : undefined}
      >
        {hydrated && connection.isConnecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
    </div>;
  }

  const localAccountPanel = <div className="wallet-popover connected-popover account-menu" role="dialog" aria-modal={isMobileAccountSheet ? "true" : undefined} aria-label={wallet.providerName ?? "Makoto Local Wallet"}>
    <div className="wallet-popover-heading"><strong>{t("wallet.account")}</strong><button ref={panelCloseRef} onClick={(event) => closeAccount(event.detail === 0)} aria-label={t("common.close")}>×</button></div>
    <span className="account-provider">{wallet.providerName ?? "Makoto Local Wallet"}</span>
    <p className="account-address">{shortAddress(activeAddress)}</p>
    <div className="account-links"><button onClick={() => void copyAddress()}>{copied ? t("wallet.copied") : t("wallet.copy")}</button><a href={`${ARC_EXPLORER_URL}/address/${activeAddress}`} target="_blank" rel="noreferrer">{t("wallet.arcscan")} ↗</a></div>
    <div className="wallet-network-row"><span>{t("wallet.network")}</span><strong><i className={activeOnArc ? "healthy-dot" : "warning-dot"} />{activeOnArc ? t("network.arc") : t("wallet.wrongNetwork")}</strong></div>
    <div className="wallet-network-row"><span>{t("wallet.wallet")}</span><strong>{wallet.status === "connected" ? t("onboarding.unlocked") : t("onboarding.locked")}</strong></div>
    <a className="account-settings-link" href="/settings#security" onClick={() => setAccountOpen(false)}>{t("overview.securityCenter")}</a>
  </div>;

  const accountPanel = localWallet ? localAccountPanel : <div className="wallet-popover connected-popover account-menu" role="dialog" aria-modal={isMobileAccountSheet ? "true" : undefined} aria-label={t("wallet.connected")}>
    <div className="wallet-popover-heading"><strong>{t("wallet.account")}</strong><button ref={panelCloseRef} onClick={(event) => closeAccount(event.detail === 0)} aria-label={t("common.close")}>×</button></div>
    <span className="account-provider">{walletKind === "embedded" ? t("onboarding.walletType") : t("onboarding.externalWalletType")}{walletName ? ` · ${walletName}` : ""}</span>
    <p className="account-address">{shortAddress(activeAddress)}</p>
    <div className="account-links"><button onClick={() => void copyAddress()}>{copied ? t("wallet.copied") : t("wallet.copy")}</button><a href={`${ARC_EXPLORER_URL}/address/${activeAddress}`} target="_blank" rel="noreferrer">{t("wallet.arcscan")} ↗</a></div>
    <div className="wallet-network-row"><span>{t("wallet.network")}</span><strong><i className={onArc ? "healthy-dot" : "warning-dot"} />{onArc ? t("network.arc") : t("wallet.wrongNetwork")}</strong></div>
    {onArc ? <div className="wallet-balances"><div><span>{t("wallet.usdcBalance")}</span><strong>{balances.usdc.data === undefined ? "…" : formatUsdc(balances.usdc.data)} USDC</strong></div></div> : <button className="switch-button" onClick={() => void switchToArc()} disabled={isSwitchPending(verifiedChain.switchStatus)}>{switchButtonLabel(verifiedChain.switchStatus, t)}</button>}
    {verifiedChain.switchMessage && <p className={verifiedChain.switchStatus === "connected" ? "wallet-success" : "wallet-error"} role="status">{verifiedChain.switchMessage}</p>}
    {message && <p className="wallet-error" role="alert">{message}</p>}
    <details className="about-menu"><summary>{t("about.title")}</summary><p>{t("about.copy")}</p></details>
    <button className="disconnect-button" onClick={() => { disconnect.mutate(); setAccountOpen(false); setMessage(undefined); }}>{t("wallet.disconnect")}</button>
  </div>;

  const mobileAccountOverlay = accountOpen && isMobileAccountSheet && typeof document !== "undefined"
    ? createPortal(<>
        <button className="account-sheet-backdrop" type="button" onClick={() => closeAccount()} aria-label={t("common.close")} />
        {accountPanel}
      </>, document.body)
    : null;

  return <div ref={controlRef} className="wallet-control connected">
    <button ref={triggerRef} className={`wallet-summary ${activeOnArc ? "on-arc" : "wrong-chain"}`} onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen}>
      <span className="wallet-status-dot" />
      <span><strong>{shortAddress(activeAddress)}</strong><small>{localWallet ? `${wallet.providerName ?? "Makoto Local Wallet"} · ${wallet.status === "connected" ? t("onboarding.unlocked") : t("onboarding.locked")}` : activeOnArc ? t("network.arc") : t("wallet.wrongNetwork")}</small></span>
    </button>
    {accountOpen && !isMobileAccountSheet && accountPanel}
    {mobileAccountOverlay}
  </div>;
}

function isSwitchPending(status: string) { return status === "waiting" || status === "switching" || status === "missing"; }

function switchButtonLabel(status: string, t: ReturnType<typeof usePreferences>["t"]) {
  if (status === "waiting" || status === "missing") return t("wallet.waiting");
  if (status === "switching") return t("wallet.switching");
  if (status === "connected") return t("wallet.arcConnected");
  return t("wallet.switch");
}
