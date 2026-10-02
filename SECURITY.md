# Security Policy

## Current scope

Makoto Wallet currently targets Arc Testnet and is non-custodial. The connected wallet signs writes. Makoto Agent does not receive seed phrases, private keys, or custodial signing authority.

## Reporting a vulnerability

Do not post exploit details, secrets, private keys, or live sensitive information in a public GitHub issue. Prefer GitHub private vulnerability reporting / Security Advisories when available.

If private reporting is unavailable, contact the repository maintainer through GitHub first to establish a private channel before sharing sensitive details.

## Safety boundary

- The LLM cannot authorize or sign writes.
- Deterministic Policy/Risk remains authoritative.
- Explicit user wallet confirmation is required for writes.
- Receipt and matching transaction evidence are required before a confirmed status is reported. Bridge destination completion requires destination evidence.

## Testnet notice

Makoto Wallet is testnet only, is not independently professionally audited, and is not mainnet-ready financial software. Testnet assets have no intended real-world monetary value.
