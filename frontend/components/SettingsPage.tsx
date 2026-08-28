"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { arcTestnet } from "viem/chains";
import { AppHeader } from "./AppHeader";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { deriveNetworkSafety, deriveOverallSecurityStatus, deriveSecurityAlerts, summarizeJarProtection, type ProtectionLoadState, type SecurityAlert, type SecurityOverallStatus } from "@/lib/securityCenter";
import styles from "./MakotoWallet.module.css";

export function SettingsPage() {
  const { locale, setLocale, theme, setTheme, resetPreferences } = usePreferences();
  const connection = useConnection();
  const chain = useVerifiedWalletChain();
  const canReadJars = connection.isConnected && chain.isArc;
  const ownerJars = useOwnerJars(canReadJars ? connection.address : undefined);
  const [copied, setCopied] = useState(false);
  const vi = locale === "vi";
  const network = deriveNetworkSafety(connection.isConnected, chain.isArc);
  const protectionState: ProtectionLoadState = !canReadJars ? "unavailable" : ownerJars.isLoading ? "loading" : ownerJars.error ? "error" : "ready";
  const alerts = deriveSecurityAlerts({ network, protectionState, summary: summarizeJarProtection(ownerJars.jars) });
  const overall = deriveOverallSecurityStatus(network, protectionState, alerts);
  const visibleAlerts = overall === "review" ? alerts : [];
  const switching = ["waiting", "switching", "missing"].includes(chain.switchStatus);

  useEffect(() => {
    const settleSettingsFragment = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id !== "security") return;
      window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    settleSettingsFragment();
    window.addEventListener("hashchange", settleSettingsFragment);
    return () => window.removeEventListener("hashchange", settleSettingsFragment);
  }, []);

  async function copyAddress() {
    if (!connection.address) return;
    await navigator.clipboard.writeText(connection.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return <main className={styles.page}><div className={styles.shell}>
    <AppHeader />
    <div id="security" className={styles.hashDestination}>
      <section className={styles.settingsHero}><h1>{vi ? "Bảo mật" : "Security"}</h1><span>{vi ? "Trạng thái ví và mạng." : "Wallet and network status."}</span></section>
      <section className={`${styles.securityOverview} ${styles[`securityOverview_${overall}`]}`} aria-labelledby="security-status-title"><div><h2 id="security-status-title">{statusLabel(overall, vi)}</h2><p>{statusCopy(overall, vi)}</p></div><span className={styles.securityStatusDot} aria-hidden="true" /></section>
    </div>

    <div className={styles.settingsGrid}>
      <SettingsCard title={vi ? "Ví đã kết nối" : "Connected wallet"}>{connection.isConnected && connection.address ? <><InfoRow label={vi ? "Địa chỉ" : "Address"} value={shortAddress(connection.address)} /><InfoRow label={vi ? "Nhà cung cấp" : "Provider"} value={connection.connector?.name ?? (vi ? "Không xác định" : "Unknown")} /><InfoRow label={vi ? "Mạng" : "Network"} value={network === "correct" ? "Arc Testnet" : (vi ? "Chưa xác minh" : "Unverified")} /><div className={styles.settingsActions}><button type="button" onClick={() => void copyAddress()}>{copied ? (vi ? "Đã sao chép" : "Copied") : (vi ? "Sao chép" : "Copy")}</button><a href={`${ARC_EXPLORER_URL}/address/${connection.address}`} target="_blank" rel="noreferrer">ArcScan ↗</a></div></> : <p className={styles.settingsMuted}>{vi ? "Chưa kết nối." : "Not connected."}</p>}</SettingsCard>
      <SettingsCard title={vi ? "An toàn mạng" : "Network safety"}><InfoRow label={vi ? "Mạng" : "Network"} value="Arc Testnet" /><InfoRow label="Chain ID" value={String(arcTestnet.id)} /><InfoRow label={vi ? "Token gas" : "Gas token"} value="USDC" /><InfoRow label={vi ? "Trạng thái" : "Status"} value={network === "correct" ? (vi ? "Đúng mạng" : "Correct") : network === "wrong" ? (vi ? "Sai mạng" : "Wrong network") : (vi ? "Chưa kết nối" : "Disconnected")} />{network === "wrong" && <div className={styles.settingsActions}><button type="button" disabled={switching} onClick={() => void chain.switchToArc()}>{switching ? (vi ? "Đang chuyển…" : "Switching…") : (vi ? "Chuyển mạng" : "Switch network")}</button></div>}{chain.switchMessage && network === "wrong" && <p className={styles.settingsMuted} role="status">{chain.switchMessage}</p>}<a className={styles.settingsLink} href={ARC_EXPLORER_URL} target="_blank" rel="noreferrer">ArcScan ↗</a></SettingsCard>
      <SettingsCard title={vi ? "Quyền riêng tư" : "Privacy"} wide><ul className={styles.settingsDisclosure}><li>{vi ? "Dữ liệu được lưu trên trình duyệt này." : "Data stays in this browser."}</li><li>{vi ? "Không chia sẻ khóa riêng tư hoặc dữ liệu bí mật." : "Never share private keys or secret data."}</li></ul></SettingsCard>
      {visibleAlerts.length > 0 && <SettingsCard title={vi ? "Cảnh báo" : "Alerts"} wide><div className={styles.securityAlerts} aria-live="polite">{visibleAlerts.map((alert) => <AlertRow key={alert.code} alert={alert} vi={vi} />)}</div></SettingsCard>}
      <SettingsCard title={vi ? "Giao diện" : "Appearance"}><ChoiceGroup label={vi ? "Chủ đề" : "Theme"} value={theme} onChange={setTheme} options={[["system", vi ? "Hệ thống" : "System"], ["light", vi ? "Sáng" : "Light"], ["dark", vi ? "Tối" : "Dark"]]} /></SettingsCard>
      <SettingsCard title={vi ? "Ngôn ngữ" : "Language"}><ChoiceGroup label={vi ? "Ngôn ngữ" : "Language"} value={locale} onChange={setLocale} options={[["en", "English"], ["vi", "Tiếng Việt"]]} /></SettingsCard>
    </div>
    <div className={styles.settingsPreferenceReset}><button type="button" onClick={resetPreferences}>{vi ? "Đặt lại tùy chọn" : "Reset preferences"}</button></div>
  </div></main>;
}

function statusLabel(status: SecurityOverallStatus, vi: boolean) { return ({ protected: vi ? "Được bảo vệ" : "Protected", review: vi ? "Cần kiểm tra" : "Review needed", disconnected: vi ? "Chưa kết nối" : "Disconnected", unknown: vi ? "Chưa xác định" : "Unknown" })[status]; }
function statusCopy(status: SecurityOverallStatus, vi: boolean) { return ({ protected: vi ? "Không có cảnh báo." : "No active alerts.", review: vi ? "Kiểm tra cảnh báo bên dưới." : "Check the alerts below.", disconnected: vi ? "Kết nối ví để kiểm tra." : "Connect a wallet to check.", unknown: vi ? "Chưa thể xác minh." : "Status unavailable." })[status]; }
function alertText(alert: SecurityAlert, vi: boolean): [string, string] { const n = alert.count ?? 0; return ({ disconnected: [vi ? "Chưa kết nối ví" : "Wallet disconnected", vi ? "Kết nối ví để kiểm tra." : "Connect a wallet to check."], "wrong-network": [vi ? "Sai mạng" : "Wrong network", vi ? "Chuyển sang Arc Testnet." : "Switch to Arc Testnet."], "protection-loading": [vi ? "Đang kiểm tra" : "Checking goals", vi ? "Đang tải trạng thái." : "Loading status."], "protection-unavailable": [vi ? "Không thể xác minh" : "Status unavailable", vi ? "Hãy thử lại sau." : "Try again later."], "frozen-jars": [vi ? `${n} mục tiêu đang đóng băng` : `${n} frozen goal${n === 1 ? "" : "s"}`, vi ? "Kiểm tra trạng thái khôi phục." : "Check recovery status."], "pending-owner-recovery": [vi ? `${n} yêu cầu khôi phục đang chờ` : `${n} pending owner recover${n === 1 ? "y" : "ies"}`, vi ? "Kiểm tra yêu cầu." : "Review the request."], "pending-guardian-change": [vi ? `${n} thay đổi Guardian đang chờ` : `${n} pending Guardian change${n === 1 ? "" : "s"}`, vi ? "Kiểm tra thay đổi." : "Review the change."], "shielded-without-guardian": [vi ? `${n} mục tiêu SHIELDED chưa có Guardian` : `${n} SHIELDED goal${n === 1 ? "" : "s"} without a Guardian`, vi ? "Có thể thêm Guardian trong Vault." : "Add one in Vault if needed."], "shielded-without-recovery": [vi ? `${n} mục tiêu SHIELDED chưa có ví khôi phục` : `${n} SHIELDED goal${n === 1 ? "" : "s"} without recovery`, vi ? "Có thể thêm ví khôi phục trong Vault." : "Add one in Vault if needed."] } satisfies Record<SecurityAlert["code"], [string, string]>)[alert.code]; }
function AlertRow({ alert, vi }: { alert: SecurityAlert; vi: boolean }) { const [title, detail] = alertText(alert, vi); return <div className={`${styles.securityAlert} ${styles[`securityAlert_${alert.severity}`]}`}><strong>{title}</strong><span>{detail}</span></div>; }
function SettingsCard({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) { return <section className={`${styles.settingsCard} ${wide ? styles.settingsWide : ""}`}><h2>{title}</h2>{children}</section>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className={styles.settingsInfo}><span>{label}</span><strong>{value}</strong></div>; }
function ChoiceGroup<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange(value: T): void; options: readonly (readonly [T, string])[] }) { return <fieldset className={styles.settingsChoices}><legend>{label}</legend>{options.map(([option, text]) => <label key={option}><input type="radio" name={label} value={option} checked={value === option} onChange={() => onChange(option)} /><span>{text}</span></label>)}</fieldset>; }
