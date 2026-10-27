/**
 * Type-only shim. The real package is bundled by Vite (lazy chunk); pointing TypeScript
 * here avoids resolving the large @walletconnect type graph on every check.
 */
declare const UniversalProvider: { init(opts: Record<string, unknown>): Promise<unknown> }
export default UniversalProvider
