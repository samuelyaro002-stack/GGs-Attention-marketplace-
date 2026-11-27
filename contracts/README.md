# G$ reward pool deployment

`GGsRewardPoolGDollar.sol` implements the campaign payout lifecycle:

1. The project calls `createCampaign()` with an explicit native CELO amount. On Celo, the native CELO balance is also ERC-20-compatible at `0x471EcE3750Da237f93B8E339c536989b8978a438`; do not wrap it as WETH.
2. The project requests a fresh Celo QuoterV2 quote, enters its own slippage in basis points, then calls `finalizeSwap()` with the quote-derived minimum and short onchain deadline. The contract approves and swaps CELO directly through Celo's SwapRouter02.
3. GG's backend builds a Merkle tree from final XP shares of the actual G$ output.
4. The project calls `publishRoot()`.
5. Creators claim G$ with their wallet and Merkle proof.

## Before deployment

- Target Celo mainnet. Verify the Celo CELO/G$ pool, fee tier, SwapRouter02 (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`), QuoterV2 (`0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8`), and GoodDollar Identity registry against current official documentation and onchain state.
- Review and audit the contract. It is hackathon/testnet-grade and should not receive real funds without professional review.
- Use small demo amounts. Thin G$ liquidity makes large single swaps unsafe.

The API readiness check confirms the configured chain, deployed pool, G$ token, identity registry, and Celo router/Quoter path. Campaign funding remains disabled if any check fails. `ethFundedRaw` and the Solidity `ethDeposited` field are retained legacy names; their values are native CELO wei on Celo.

## App configuration

After deployment, configure the same deployed address in both services:

- `REWARD_POOL_CONTRACT_ADDRESS` — API server distribution/config response.
- `VITE_REWARD_POOL_CONTRACT_ADDRESS` — browser wallet transaction client.
- `REWARD_POOL_RPC_URL` — API server's Celo RPC endpoint; store it through Replit Secrets if the URL contains a credential.
- `CLERK_ADMIN_USER_IDS` — comma-separated Clerk user IDs explicitly approved to manage campaign payouts. An empty value grants nobody; the first signed-in user is never promoted automatically.

The contract addresses must match exactly. The app intentionally remains in a staged, non-signing state while either address is unset or the API cannot verify the Celo deployment and swap path.