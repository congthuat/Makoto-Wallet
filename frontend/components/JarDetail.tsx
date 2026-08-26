"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBlock, useConnection } from "wagmi";
import { arcTestnet } from "viem/chains";
import { AppHeader } from "./AppHeader";
import { DisabledActions } from "./DisabledActions";
import { OwnerDepositFlow } from "./OwnerDepositFlow";
import { SharedContributionFlow } from "./SharedContributionFlow";
import { OwnerWithdrawalFlow } from "./OwnerWithdrawalFlow";
import { ProgressBar } from "./ProgressBar";
import { StatePanel } from "./StatePanel";
import { useJar } from "@/hooks/useJar";
import { useHydrated } from "@/hooks/useHydrated";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { ARC_EXPLORER_URL, contractAddress, contractAddressError } from "@/lib/config";
import { formatDate, formatUsdc, progressPercent, shortAddress } from "@/lib/format";
import { usePreferences } from "@/hooks/usePreferences";
import { useJarActivity } from "@/hooks/useJarActivity";
import { JarActivity } from "./JarActivity";
import { ShareJar } from "./ShareJar";
import { PrivateMetadataPanel } from "./PrivateMetadataPanel";
import { JarSecurityPanel } from "./JarSecurityPanel";
import { consumeAgentHandoff, handoffUrl, resetAgentHandoffGoal, storeAgentHandoff, type AgentActionHandoff } from "@/lib/agent/actions";
import { canJarAcceptDeposits } from "@/lib/jarDepositEligibility";

export function JarDetail({ jarIdParam }: { jarIdParam: string }) {
  const { t } = usePreferences();
  const parsedJarId = /^\d{1,78}$/.test(jarIdParam) ? BigInt(jarIdParam) : undefined;
  const validJarId = parsedJarId !== undefined && parsedJarId > 0n && parsedJarId <= 2n ** 256n - 1n;
  const jarId = validJarId ? parsedJarId : undefined;
  const connection = useConnection();
  const verifiedChain = useVerifiedWalletChain();
  const hydrated = useHydrated();
  const [depositOpen, setDepositOpen] = useState(false);
  const [contributionOpen, setContributionOpen] = useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [agentHandoff, setAgentHandoff] = useState<AgentActionHandoff>();
  const latestBlock = useBlock({ chainId: arcTestnet.id, query: { enabled: Boolean(contractAddress), staleTime: 30_000 } });
  const viewer = hydrated && connection.isConnected ? connection.address : undefined;

  const { jar, viewerContribution, isLoading, error, refetch } = useJar(jarId, viewer);
  const activity = useJarActivity(jarId);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("agentHandoff"); if (!id || !connection.address || !jar) return; const timer = window.setTimeout(() => { const handoff = consumeAgentHandoff(window.sessionStorage, id, connection.address); window.history.replaceState({}, "", window.location.pathname); if (!handoff || handoff.jarId !== jar.id.toString() || jar.owner.toLowerCase() !== connection.address!.toLowerCase()) return; if (handoff.action === "vault-deposit" && !canJarAcceptDeposits(jar)) { const reselection = resetAgentHandoffGoal(handoff); storeAgentHandoff(window.sessionStorage, reselection); window.location.assign(handoffUrl(reselection)); return; } if (jar.closed) return; setAgentHandoff(handoff); if (handoff.action === "vault-deposit") setDepositOpen(true); else if (handoff.action === "vault-withdraw") setWithdrawalOpen(true); }, 0); return () => window.clearTimeout(timer); }, [connection.address, jar]);

  if (contractAddressError || !contractAddress) return <DetailState title={t("jar.contractConfigTitle")} copy={contractAddressError ?? t("jar.contractConfigCopy")} />;
  if (!validJarId) return <DetailState title={t("jar.invalidIdTitle")} copy={t("jar.invalidIdCopy")} />;
  if (isLoading) return <DetailState title={t("jar.openingTitle")} copy={t("jar.openingCopy")} loading />;
  if (error || !jar) return <DetailState title={t("jar.openFailed")} copy={t("jar.openFailedCopy")} action={<button className="secondary-button" onClick={() => void refetch()}>{t("common.tryAgain")}</button>} />;

  const progress = progressPercent(jar.balance, jar.targetAmount);
  const chainTimestamp = latestBlock.data?.timestamp;
  const unlockedOnchain = chainTimestamp !== undefined && chainTimestamp >= jar.unlockTime;
  const status = jar.closed ? "Closed" : unlockedOnchain ? "Unlocked" : "Locked";
  const statusLabel = status === "Locked" ? t("status.locked") : status === "Unlocked" ? t("status.unlocked") : t("status.closed");
  const activityItems = [...(activity.data ?? []), ...(unlockedOnchain ? [{ id: `unlock-${jar.id}`, type: "unlocked" as const, actor: jar.owner, timestamp: jar.unlockTime, blockNumber: 0n, logIndex: 0 }] : [])].sort((a, b) => a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0);
  const ownerConnected = Boolean(hydrated && connection.isConnected && connection.address?.toLowerCase() === jar.owner.toLowerCase());
  function reselectAgentGoal() { if (!agentHandoff) return; const reselection = resetAgentHandoffGoal(agentHandoff); storeAgentHandoff(window.sessionStorage, reselection); window.location.assign(handoffUrl(reselection)); }
  const depositEnabled = ownerConnected && verifiedChain.isArc && status === "Locked";
  const contributeEnabled = Boolean(hydrated && connection.isConnected && verifiedChain.isArc && status === "Locked");
  const withdrawEnabled = Boolean(ownerConnected && verifiedChain.isArc && unlockedOnchain && jar.balance > 0n && !jar.closed && jar.mode === 0 && !jar.frozen);
  const depositReason = jar.closed ? t("actions.closed") : !ownerConnected ? t("common.ownerOnly") : !verifiedChain.isArc ? t("common.arcRequired") : unlockedOnchain ? `${t("status.unlocked")} ${formatDate(jar.unlockTime)}` : t("common.ready");
  const contributeReason = jar.closed ? t("actions.closed") : !hydrated || !connection.isConnected ? t("actions.connectContribute") : !verifiedChain.isArc ? t("common.arcRequired") : unlockedOnchain ? `${t("status.unlocked")} ${formatDate(jar.unlockTime)}` : t("common.ready");
  const withdrawReason = !ownerConnected
    ? t("actions.onlyOwnerWithdraw")
    : !verifiedChain.isArc
      ? t("actions.switchOwner")
      : jar.closed
        ? t("actions.withdrawn")
        : jar.balance === 0n
          ? t("actions.noBalance")
          : !unlockedOnchain
            ? `${t("jar.unlocks")} ${formatDate(jar.unlockTime)}`
            : t("actions.readyWithdraw");

  return (
    <main className="jar-detail-page"><div className="shell"><AppHeader />
      <div className="detail-back"><Link href="/">← {t("jar.back")}</Link><a href={`${ARC_EXPLORER_URL}/address/${contractAddress}`} target="_blank" rel="noreferrer">{t("jar.contractArcscan")} ↗</a></div>
      <section className="detail-hero">
        <div className="detail-title"><span className={`status-pill ${status.toLowerCase()}`}>{statusLabel}</span><p className="eyebrow">{t("jar.number", { id: jar.id.toString() })}</p><h1>{jar.name}</h1><p>{t("jar.created", { date: formatDate(jar.createdAt) })} · {jar.totalContributed > 0n ? t("jar.sharedActivity") : t("jar.personal")}</p><ShareJar jar={jar} /></div>
        <div className="detail-mascot" aria-hidden="true"><span>•ᴗ•</span></div>
      </section>
      <PrivateMetadataPanel jar={jar} />
      <section className="detail-grid">
        <article className="balance-card"><p>{t("jar.saved")}</p><div><strong>{formatUsdc(jar.balance)}</strong><span>USDC</span></div><div className="detail-progress-label"><span>{t("jar.percentSaved", { percent: progress.toFixed(1) })} · {t("jar.target")} {formatUsdc(jar.targetAmount)} USDC</span><span>{statusLabel}</span></div><ProgressBar value={progress} /></article>
        <article className="facts-card"><div><span>{t("jar.unlockDate")}</span><strong>{formatDate(jar.unlockTime)}</strong><small>{status === "Locked" ? t("jar.lockedUntil") : statusLabel}</small></div><div><span>{t("jar.owner")}</span><strong title={jar.owner}>{shortAddress(jar.owner)}</strong><small>{t("jar.ownerCanWithdraw")}</small></div><div><span>{t("jar.shared")}</span><strong>{formatUsdc(jar.totalContributed)} USDC</strong><small>{t("jar.sentContribution")}</small></div><div><span>{t("jar.yourShared")}</span><strong>{viewerContribution === undefined ? "—" : `${formatUsdc(viewerContribution)} USDC`}</strong><small>{viewer ? shortAddress(viewer) : t("jar.connectToView")}</small></div></article>
      </section>
      <div className="security-badges"><span>{jar.mode === 0 ? t("create.safe") : t("create.shielded")}</span>{jar.guardian !== "0x0000000000000000000000000000000000000000" && <span>{t("jar.guardianProtected")}</span>}{jar.privacyMode === 1 && <span>{t("jar.privateMetadata")}</span>}</div>
      <p className="accounting-note">{t("jar.accounting")}</p>
      <DisabledActions depositEnabled={depositEnabled} contributeEnabled={contributeEnabled} withdrawEnabled={withdrawEnabled} depositReason={depositReason} contributeReason={contributeReason} withdrawReason={withdrawReason} ownerConnected={ownerConnected} onDeposit={() => setDepositOpen(true)} onContribute={() => setContributionOpen(true)} onWithdraw={() => setWithdrawalOpen(true)} />
      <JarSecurityPanel jar={jar} now={chainTimestamp ?? 0n} onRefresh={async () => { await Promise.all([refetch(), latestBlock.refetch(), activity.refetch()]); }} onWithdraw={() => setWithdrawalOpen(true)} />
      <JarActivity items={activityItems} isLoading={activity.isLoading} isError={activity.isError} onRetry={() => void activity.refetch()} />
      <section className="trust-note"><span aria-hidden="true">⌁</span><div><strong>{t("jar.lockMeansLocked")}</strong><p>{t("jar.lockRule")}</p></div></section>
      <footer><span>Makoto Vault · Arc Testnet</span><span>{t("footer.rule")}</span></footer>
      <OwnerDepositFlow jar={jar} open={depositOpen} initialAmount={agentHandoff?.action === "vault-deposit" ? agentHandoff.amount : undefined} origin={agentHandoff?.action === "vault-deposit" ? "agent" : undefined} onAgentGoalIneligible={reselectAgentGoal} onClose={() => setDepositOpen(false)} onSuccess={async () => { await Promise.all([refetch(), activity.refetch()]); }} />
      <SharedContributionFlow jar={jar} open={contributionOpen} onClose={() => setContributionOpen(false)} onSuccess={async () => { await Promise.all([refetch(), activity.refetch()]); }} />
      <OwnerWithdrawalFlow jar={jar} open={withdrawalOpen} origin={agentHandoff?.action === "vault-withdraw" ? "agent" : undefined} onClose={() => setWithdrawalOpen(false)} onSuccess={async () => { await Promise.all([refetch(), latestBlock.refetch(), activity.refetch()]); }} />
    </div></main>
  );
}

function DetailState({ title, copy, loading, action }: { title: string; copy: string; loading?: boolean; action?: React.ReactNode }) {
  return <main className="jar-detail-page"><div className="shell"><AppHeader /><div className="detail-state"><StatePanel icon={loading ? "…" : "!"} title={title}><p>{copy}</p>{action}</StatePanel></div></div></main>;
}
