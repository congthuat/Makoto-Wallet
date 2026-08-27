"use client";

import { useMemo, useState } from "react";
import { balanceChange, filterBalanceHistory, type BalanceHistoryRange, type BalanceSnapshot } from "@/lib/balanceHistory";
import { formatUsdc } from "@/lib/format";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./MakotoWallet.module.css";

const ranges: BalanceHistoryRange[] = ["1D", "1W", "1M", "1Y", "All"];

export function BalanceHistoryChart({ history, locale }: { history: BalanceSnapshot[]; locale: "en" | "vi" }) {
  const { t } = usePreferences();
  const [range, setRange] = useState<BalanceHistoryRange>("1M");
  const points = useMemo(() => filterBalanceHistory(history, range), [history, range]);
  const change = balanceChange(points);
  const geometry = useMemo(() => chartGeometry(points), [points]);

  return <section className={styles.balanceChart} aria-label={locale === "vi" ? "Lịch sử số dư USDC thực tế" : "Observed USDC balance history"}>
    <div className={styles.chartRanges} aria-label={locale === "vi" ? "Khoảng thời gian" : "History range"}>{ranges.map((item) => <button type="button" key={item} className={range === item ? styles.chartRangeActive : undefined} aria-pressed={range === item} onClick={() => setRange(item)}>{item === "All" ? t("walletHome.historyRangeAll") : item}</button>)}</div>
    {change !== undefined && <p className={`${styles.chartChange} ${change > 0n ? styles.chartPositive : ""}`}>{change > 0n ? "+" : change < 0n ? "−" : ""}{formatUsdc(change < 0n ? -change : change)} USDC <span>{range === "All" ? t("walletHome.historyRangeAll") : range}</span></p>}
    {geometry ? <svg className={styles.chartSvg} viewBox="0 0 420 150" role="img" aria-label={`${points.length} ${locale === "vi" ? "quan sát số dư thực tế" : "real balance observations"}`} preserveAspectRatio="none">
      <defs><linearGradient id="balance-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".24"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      <g className={styles.chartGrid} aria-hidden="true"><path d="M0 30H420M0 75H420M0 120H420" /></g>
      <path className={styles.chartArea} d={`${geometry.path} L420 150 L0 150 Z`} />
      <path className={styles.chartLine} d={geometry.path} />
      {geometry.coordinates.map(([x,y], index) => <circle key={`${points[index].timestamp}-${index}`} cx={x} cy={y} r="2.5"><title>{formatUsdc(points[index].balance)} USDC · {new Date(points[index].timestamp).toLocaleString(locale)}</title></circle>)}
    </svg> : <div className={styles.chartEmpty}><span aria-hidden="true"/><p>{locale === "vi" ? "Lịch sử số dư sẽ được xây dựng khi bạn sử dụng Makoto." : "Balance history will build as you use Makoto."}</p></div>}
  </section>;
}

function chartGeometry(points: BalanceSnapshot[]) {
  if (points.length < 2) return undefined;
  const values = points.map((point) => point.balance); const minimum = values.reduce((a,b) => a < b ? a : b); const maximum = values.reduce((a,b) => a > b ? a : b); const spread = maximum - minimum;
  const coordinates = points.map((point,index) => [index * 420 / (points.length - 1), spread === 0n ? 75 : 132 - Number((point.balance - minimum) * 114n / spread)] as const);
  return { coordinates, path: coordinates.map(([x,y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") };
}
