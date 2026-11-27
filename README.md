# GG's Attention Marketplace

A creator attention marketplace built on Celo. Projects fund a campaign in CELO, creators post about it, engagement is scored into XP, and the platform administrator pays each creator their XP share from the contract in one batch. A fixed 10% protocol fee is enforced by the smart contract at funding time.

**Website:** https://ggattention.app
**Deployment guide:** [DEPLOY.md](DEPLOY.md)
**Demo video:** [add link]
**Walkthrough video:** [add link]

## Status

| Area | State |
| --- | --- |
| Daily G$ UBI claim (GoodDollar SDK) | Live on Celo Mainnet |
| CELO reward pool contract | Deployed and source-verified on Celo Sepolia (testnet) |
| Fund, score and payout cycle | Proven end to end on Celo Sepolia |
| Engagement scoring | Deterministic demo scoring, social APIs not connected yet |
| Smart contract audit | Not audited |
| Reward pool on Celo Mainnet | Not deployed |

## How it works

1. A project creates a campaign and funds it in CELO. Funding is two wallet confirmations: approve the CELO transfer, then call `createCampaign` on the reward pool contract.
2. The contract takes a fixed 10% protocol fee in the same transaction and holds the remaining 90% as the creator pool.
3. Creators submit a post for the campaign with a wallet address to be paid to.
4. Each submission is scored into XP. A creator's share of the pool is `creatorXP / totalCampaignXP`.
5. The administrator reviews the XP table on the admin Payouts page and triggers `distributeBatch`. The contract pays each creator directly. The administrator wallet pays gas only and never holds the pool.
6. After the payout window closes, the funding wallet can reclaim anything undistributed with `withdrawRemaining`.

Creators do not need CELO for gas and do not need to claim anything.

## On-chain details (Celo Sepolia, chain ID 11142220)

| Item | Value |
| --- | --- |
| Reward pool contract | `0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc` |
| Explorer | https://celo-sepolia.blockscout.com/address/0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc |
| CELO token | `0x471EcE3750Da237f93B8E339c536989b8978a438` |
| Protocol fee wallet | `0x0d8C36615D9026d8658da26C9A1E1C44B469865D` |
| Contract owner / admin | `0x91b2D43890e6Ace6b1D104c51212965E8925a015` |
| Example payout transaction | `0x2c0fedfc572ee8e7d5674238e7adf1be2df8d2d066b0403b2f4b58e63c64be27` |

The example transaction paid 0.09 CELO to a test creator from a 0.1 CELO campaign (0.01 CELO fee, 0.09 CELO pool, 0 remaining).

### Contract summary

- `createCampaign(amount, requireIdentity, payoutWindowSeconds)` pulls CELO with `transferFrom`, sends the 10% fee to the protocol wallet, and records the creator pool.
- `distributeBatch(campaignId, recipients, amounts)` is owner only. It enforces that the total distributed never exceeds the pool and that no wallet is paid twice per campaign.
- `withdrawRemaining(campaignId)` lets the funding wallet reclaim the undistributed balance after the payout deadline.
- An optional GoodDollar identity check can require each recipient to be a verified unique human.
- The fee rate is a constant and cannot be changed by the owner.

## Daily G$ UBI

Verified GoodDollar users can claim their daily G$ from the GoodDollar UBI scheme inside the app, on Celo Mainnet, using `@goodsdks/citizen-sdk`. This is GoodDollar's own pool and is independent of campaign rewards.

## Tech stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, viem
- Backend: Node.js, Express
- Database: PostgreSQL with Drizzle ORM
- Auth: Privy
- Monorepo: pnpm workspaces
- Contract: Solidity 0.8.20, OpenZeppelin

## Motion and theme

The app uses the system theme before a saved preference is applied and provides Light, Dark, and System controls in shared desktop headers and mobile menus. The public brand site, marketplace surfaces, campaign tables/forms/dialogs, auth/Privy screens, toasts, and admin payout dashboard use theme-aware tokens. Motion includes visible-only overview count-ups, the translated landing scroll cue, a localized back-to-top control, and ambient/entry transitions that respect reduced-motion and hidden-tab preferences.

Shared motion tokens are defined in `src/motion.css`: fast 150 ms, base 250 ms, slow 500 ms, with separate entrance and movement easing. Use transform/opacity for motion, stable record keys for layout movement, and a reduced-motion alternative. Animate success only after a successful receipt and marketplace sync. Locale formatting must start from raw numeric values, never by parsing a localized display string.

The ecosystem marquee uses technology wordmarks for Celo and GoodDollar rather than unapproved partner logos. It does not imply sponsorship. Existing list order and rank changes animate; no new campaign filtering or sorting feature is introduced by this UI update.

Application-owned UI copy across navigation, the brand site, campaign and creator flows, leaderboard, Daily G$, auth/account, legal drafts, and admin payouts is served from i18next resources. English is the complete source locale. Spanish, French, and Simplified Chinese resources are available and marked **Beta** in the language menu; these translations are not approved. Missing translation keys fall back to English.

### Translation review TODO

- **Required before describing beta translations as approved:** qualified human language reviewers must review the Spanish, French, and Simplified Chinese resources for accuracy, consistency, grammar, and context.
- **Money and payout terminology:** qualified finance/payout reviewers must review amounts, fees, pool shares, funding, payouts, refunds, and payout statuses in all three beta locales.
- **Legal terminology:** qualified counsel must review the complete Privacy and Terms drafts, notices, and all legal wording in each beta locale before publication.
- **CELO and wallet terminology:** a qualified CELO/wallet reviewer must verify network, chain, signing, transaction, receipt, eligibility, and wallet-action language in each beta locale.
- **GoodDollar terminology:** a qualified GoodDollar/product reviewer must verify UBI, identity verification, whitelist, entitlement, claim-window, claim, and biometric-data wording in each beta locale.
- Translation review is still required. No ES, FR, or zh-CN translation is represented as approved.

### UI verification boundaries

Public desktop/mobile navigation, saved themes/locales, translated long-form pages and reduced motion were exercised without changing accounts, campaigns or wallets. Signed-in admin/account views and real funding, payout and Daily G$ transactions still require authenticated verification. Mid-range Android frame-rate performance has not been benchmarked on physical hardware.

Existing artwork and its embedded text stay unchanged, as do user-entered campaign names/briefs and messages supplied by external wallet or verification providers. GG controls its own UI and Privy appearance, not the interface of an external wallet application. Count-ups are used for overview summaries; exact transaction balances stay static and retain all token decimals. The funding checkmark uses scale/fade rather than animated stroke properties to honor the transform/opacity-only rule.

The browser pass also observed two nonce-based inline-style CSP warnings. The marketplace response does not set a CSP header, and no security policy was weakened to suppress those warnings. Further tracing of the embedded-provider warnings remains outstanding.

## Running locally

Requirements: Node.js 22, pnpm 10, a PostgreSQL database. Use Linux, macOS-compatible Linux tooling, WSL or Docker: the pnpm overrides in `pnpm-workspace.yaml` remove non-Linux native build binaries, so a plain install on Windows will not work.

```bash
pnpm install
cp .env.example .env   # fill in your own values
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ggs-marketplace run dev
```

To run the whole product in one container, see [DEPLOY.md](DEPLOY.md) and the `Dockerfile`.

Environment variables hold secrets and must never be committed. Typical values include the database URL, the Privy app ID and secret, and the reward pool contract address. See `.env.example` for the exact names.

## Known limitations

- Engagement scoring is a deterministic demo. Real scoring needs social platform API access and anti-abuse checks.
- The contract has not been professionally audited. Do not use it with real funds yet.
- Payouts are administrator-triggered, so the administrator key is a trusted role. The contract limits it to the campaign pool but cannot stop it from choosing recipients within that pool.
- The reward pool is testnet only. Mainnet deployment is planned after more multi-creator testing and a security review.

## Roadmap

- Test batch payouts with many creators
- Connect real social APIs and add anti-sybil scoring
- Independent security review
- Deploy the reward pool to Celo Mainnet

## Security

If you find a vulnerability, please open a private security advisory on this repository instead of a public issue.

## License

MIT. See [LICENSE](LICENSE).

## Author

Samuel Joey Yaro (Joey), Web3 growth strategist, Kaduna, Nigeria.
