# 06 — Security & Threat Model

## Assets at risk
- USDC deposited into jars.
- Integrity of each jar balance.
- Integrity of unlock time.
- Ownership/withdrawal authorization.

## Trust model
PenguJar should be non-custodial at the application level:
- frontend never holds user private keys;
- smart contract holds pooled USDC;
- withdrawal rights are enforced by contract owner mapping;
- no operator/admin should be able to withdraw user jars.

## Main threats

### T1 — Early withdrawal
**Risk:** owner bypasses time lock.

**Control:** every withdrawal path checks `block.timestamp >= unlockTime`; no admin bypass; no alternate emergency-withdraw path in MVP.

### T2 — Unauthorized withdrawal
**Risk:** contributor/attacker withdraws another owner’s jar.

**Control:** `msg.sender == jar.owner` on withdraw; test non-owner paths.

### T3 — Reentrancy during token transfer
**Control:** checks-effects-interactions + `ReentrancyGuard` + SafeERC20.

### T4 — Broken jar accounting
**Risk:** deposit credited to wrong jar or double-accounted.

**Control:** update exactly one jar per successful transfer; invariant tests across multiple jars/users.

### T5 — USDC decimal confusion on Arc
**Risk:** mixing 18-decimal native gas units with 6-decimal ERC-20 USDC transfer units can create severe amount errors.

**Control:** application transfer code uses standard ERC-20 interface only and `parseUnits(value, 6)` / contract raw token amounts. Never infer ERC-20 transfer units from native gas balance units.

### T6 — Mutable terms after contributor pays
**Risk:** owner changes unlock conditions after someone contributes.

**Control:** unlock time immutable after creation (prefer immutable from creation, full stop).

### T7 — Donation after maturity
**Risk:** contributor sends immediately before owner withdrawal, potentially without understanding jar is already mature.

**Control:** block deposits/contributions at or after unlock.

### T8 — Direct token transfer to contract
**Risk:** USDC transferred directly to contract address will not map to a jar.

**Control:** document that only contract functions create jar credit. Do not add an admin sweep in MVP. Treat direct transfers as unaccounted balance; consider a narrowly designed recovery mechanism only after security review.

### T9 — Frontend phishing / wrong network
**Control:** frontend verifies chain ID and contract address; displays Arc Testnet; refuses write actions on unsupported chain.

### T10 — Leaked deployer key
**Control:** `.env` gitignored; test-only deployer wallet; no key in scripts/docs. Contract should not depend on deployer privileges after deployment.

## Security acceptance checklist
- [ ] No privileged fund seizure.
- [ ] Unlock cannot be shortened.
- [ ] Non-owner cannot withdraw.
- [ ] Closed jar cannot receive deposits.
- [ ] Mature jar cannot receive deposits.
- [ ] Withdraw cannot run twice.
- [ ] SafeERC20 used.
- [ ] Reentrancy protection on withdraw.
- [ ] Multiple-jar accounting tests pass.
- [ ] 6-decimal USDC amounts used for ERC-20 transfer paths.
- [ ] Arc Testnet addresses checked against current official docs before deployment.
