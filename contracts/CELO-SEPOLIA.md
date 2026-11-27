# Pure-CELO Sepolia campaign integration

This path is separate from existing mainnet G$ campaign rewards and Daily G$.
No blockchain transactions are sent by installing or verifying this integration.
Development wallet actions are enabled after checking the supplied deployment.
Production configuration is not changed.

## Contract and chain

The app uses the **exact uploaded Remix ABI**, shared by browser and API in
`@workspace/celo-contract`. It is not regenerated from Solidity.
`GGsRewardPoolCelo.verified.sol` is the source retrieved from Blockscout.
`GGsRewardPoolCelo.sol` is retained only as the historical swap-based design;
it must not be used for this deployment.

- Deployed contract: `0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc` (current; the earlier deployment `0x6799fDb282cDe85c403D1003846367d881A01FFC` is superseded)
- Protocol fee wallet: `0x0d8C36615D9026d8658da26C9A1E1C44B469865D`
- Global contract owner: `0x91b2D43890e6Ace6b1D104c51212965E8925a015`
- [Verified source](https://celo-sepolia.blockscout.com/address/0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc?tab=contract)

Source verification is **not a professional security audit**.

- Celo Sepolia chain ID: **11142220**
- Public RPC: https://forno.celo-sepolia.celo-testnet.org
- Explorer: https://celo-sepolia.blockscout.com
- Faucet: https://faucet.celo.org/celo-sepolia
- CELO / CeloToken: `0x471EcE3750Da237f93B8E339c536989b8978a438`
This deployment has no WETH, funding-token parameter, router, swap, or separate
settlement event. Funding and creator payouts are CELO.

## Initial direct-CELO test policy

1. Compare the supplied Remix ABI with the verified explorer ABI.
2. Compare live runtime bytecode with the explorer's verified bytecode.
3. Verify chain, CELO token, 1000bps fee, recipient, and global owner by RPC.
4. Enable only the approved development configuration; do not send funds.
5. Use the wallet that will own the campaign, not necessarily the global owner.
6. Use a small faucet-funded CELO amount. `approve(pool, amount)` is an ERC20
   transaction; `createCampaign(amount, false, 1209600)` is **nonpayable**.
   Never attach native `value`.

Identity is off for this initial test (`requireIdentity=false`). The deployed
identity registry is zero. Do not enable identity-gated campaigns without a
configured and verified registry.

**Permission clarification:** the instructions describe `publishRoot` as
admin-only, but the verified source requires `msg.sender == c.project`.
The campaign-funding wallet publishes roots and withdraws unclaimed CELO.
The global owner manages identity/protocol-wallet settings.
The app also retains its signed-in administrator permission checks.

## Configuration

Use the workspace configuration/secrets flow, never commit credentials:

- `CELO_REWARD_POOL_CONTRACT_ADDRESS`: reviewed Sepolia deployment.
- `CELO_REWARD_POOL_PROTOCOL_WALLET`: expected fee recipient.
- `CELO_REWARD_POOL_OWNER_WALLET`: expected global contract owner.
- `CELO_REWARD_POOL_RUNTIME_CODE_HASH`: approved runtime bytecode keccak256 hash.
- `CELO_REWARD_POOL_APPROVED`: exactly `true` only after review and approval.
- `CELO_REWARD_POOL_RPC_URL`: optional; defaults to the public Sepolia RPC.
  Store authenticated RPC URLs as secrets.
- Existing `CLERK_ADMIN_USER_IDS`: explicitly authorized administrators.

CELO browser settings come from the API config response. There is no duplicate
Vite contract-address setting. The legacy G$ configuration is unchanged.
Only development is configured by this update; production remains separate.

The runtime readiness check fails closed on missing approval, wrong chain,
missing contract/token bytecode, an unapproved runtime bytecode hash, wrong
global owner, wrong CELO token, wrong recipient, or any fee
other than 1000 basis points. This sanity check is not a replacement for source
verification or an audit.

## Lifecycle and accounting

- Create an app campaign with reward asset CELO; the displayed USD pool is only
  an estimate, not the actual deposit.
- Collect creator submissions with valid nonzero payout wallets.
- Fund after final scoring: funding freezes submissions. Direct CELO settles
  immediately, charging `floor(gross * 1000 / 10000)` and storing the remainder
  in `celoPoolRaw`. `gdPoolRaw` and `ethFundedRaw` are not reused.
- Recover the actual ID and gross/fee/net amounts from `CampaignCreated`.
  The getter returns `(project, grossDeposit, protocolFee, celoPool, celoClaimed,
  merkleRoot, requireIdentity, finalized, claimDeadline)`.
- **The 14-day claim deadline starts at contract campaign creation**, not at
  Merkle root publication. The API stores the actual onchain deadline.
- Publish the XP distribution over the net CELO pool. Claims use the uploaded
  contract's packed campaign ID/address/amount leaf format and sorted proofs.
- After expiry, the project can withdraw unclaimed CELO even without a
  published root.
- The browser saves broadcast hashes before confirmation or API recording.
  Retry recording the same transaction rather than funding or claiming twice.

The API derives funding amounts, wallet, deadline, and fee from confirmed
calldata/events/state. Binding uniqueness prevents recording the same onchain
campaign against two app campaigns. Row locks share the submission freeze
boundary. Claims and withdrawals verify the correct owner/sender, calldata,
contract-emitted events, state, and chain time. Recording an earlier confirmed
claim remains possible after expiry/refund.

## Network isolation

CELO campaigns require **Celo Sepolia (11142220)**; wallet helpers request
Sepolia and verify the active chain before writes.
Daily G$ and legacy G$ campaigns remain on **Celo Mainnet (42220)** and request
Mainnet when reconnecting from Sepolia. The identical CELO token address does
not mean these networks or their balances are interchangeable.

## Verification

`pnpm --filter @workspace/api-server run test:rewards` includes synthetic local
JSON-RPC tests for both CELO and legacy G$ verification. These tests do **not**
deploy or execute an actual EVM contract. An actual local-contract lifecycle
test and a user-authorized Sepolia funding smoke test remain separate work.