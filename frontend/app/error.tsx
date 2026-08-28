"use client";
import Link from "next/link";
import Image from "next/image";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset(): void }) { return <main className="release-state" role="alert"><Image src="/makoto/logo-pro-v2.png" alt="" width={72} height={72} /><h1>Something went wrong.</h1><div><button type="button" onClick={reset}>Retry</button><Link href="/">Return to Wallet</Link></div></main>; }
