import Image from "next/image";
export default function Loading() { return <main className="release-state" aria-live="polite" aria-busy="true"><Image src="/makoto/logo-pro-v2.png" alt="" width={72} height={72} priority /><h1>Loading…</h1><span className="release-loader" aria-hidden="true" /></main>; }
