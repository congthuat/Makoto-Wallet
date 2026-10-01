/**
 * Narrow compatibility declarations for @circle-fin/adapter-viem-v2@1.18.0.
 * Its published /next.d.mts imports `z` and `PrivateKeyAccount` from absolute
 * paths on Circle's build runner instead of package specifiers. Runtime exports
 * are valid; these declarations map only those two imported symbols to their
 * public package exports. Remove this file when Circle publishes /next types
 * without `/home/runner/_work/stablecoin-kits-private/...` imports.
 */
declare module "/home/runner/_work/stablecoin-kits-private/stablecoin-kits-private/node_modules/zod/dist/types/index.d.ts" {
  export { z } from "zod";
}

declare module "/home/runner/_work/stablecoin-kits-private/stablecoin-kits-private/node_modules/viem/_types/accounts/index.d.ts" {
  export type { PrivateKeyAccount } from "viem/accounts";
}
