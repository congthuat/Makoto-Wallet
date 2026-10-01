# 05 — Technical Architecture

## Chosen stack
### Smart contract
- Solidity 0.8.24
- Hardhat retained from the existing prototype to minimize migration cost
- OpenZeppelin SafeERC20 + ReentrancyGuard for V2
- Arc Testnet

### Frontend (when Phase 3 begins)
- Next.js + TypeScript
- wagmi + viem
- `arcTestnet` from `viem/chains`
- simple CSS/Tailwind only if it materially speeds implementation

### No backend in MVP
Jar state is contract state. Frontend reads chain directly.

For activity history, use events and a simple client-side query first. Add an indexer only if chain reads become a real UX problem.

## Arc Testnet constants
- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://testnet.arcscan.app`
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`
- ERC-20 USDC decimals: 6

Important: Arc native gas accounting uses 18 decimals; app token transfer amounts should use the ERC-20 interface and its 6 decimals.

## Proposed V2 contract model

```text
PenguJarV2
│
├─ IERC20 immutable USDC
├─ uint256 nextJarId
├─ mapping(uint256 => Jar) jars
├─ mapping(address => uint256[]) ownerJarIds
│
├─ createJar(...)
├─ depositToJar(jarId, amount)
├─ contributeToJar(jarId, amount)
├─ withdrawJar(jarId)
├─ getJar(jarId)
└─ getOwnerJarIds(owner, cursor, size) [or equivalent pagination]
```

## Proposed Jar fields
Conceptual schema; Codex may pack fields after tests define behavior.

```solidity
struct Jar {
    address owner;
    uint256 balance;
    uint256 targetAmount;
    uint64 unlockTime;
    uint64 createdAt;
    bool closed;
    string name;
}
```

## Events
At minimum:
- `JarCreated(jarId, owner, name, targetAmount, unlockTime)`
- `JarDeposited(jarId, from, amount, newBalance)`
- `JarWithdrawn(jarId, owner, amount)`

A single deposit event may cover both owner deposit and shared contribution because `from` is indexed. If UX needs explicit semantics later, split events then.

## Token flow
### Deposit / contribute
1. User approves PenguJar contract for amount.
2. PenguJar calls USDC `safeTransferFrom(user, address(this), amount)`.
3. Jar accounting increases only after successful transfer.
4. Emit event.

### Withdraw
1. Require caller == jar owner.
2. Require jar exists, not closed, and time reached.
3. Cache amount.
4. Set jar balance = 0 and closed = true.
5. Transfer USDC to owner using SafeERC20.
6. Emit event.

## Accounting invariant
For all active jars:

`sum(jar.balance) <= USDC.balanceOf(PenguJarV2)`

Equality is expected under normal operation. `<=` accounts for someone directly transferring USDC to the contract outside the app.

Never “repair” unexpected extra balance by assigning it to a random jar.

## Why keep Hardhat?
Arc is EVM-compatible and supports standard Ethereum tooling including Hardhat. Existing PenguJar already uses Hardhat, so preserving it reduces migration noise while the product model changes significantly.

Foundry can be added later for fuzz/invariant testing if it provides clear security value.
