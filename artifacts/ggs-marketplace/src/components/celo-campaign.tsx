import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGGAuth } from '@/components/auth';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, parseEther, type Hex } from 'viem';
import { ArrowUpRight, Copy, ExternalLink, Info } from 'lucide-react';
import {
  getGetCampaignQueryKey, getGetCeloRewardPoolConfigQueryKey,
  getGetCurrentUserQueryKey, getGetMarketplaceSummaryQueryKey, getListCampaignsQueryKey,
  getGetCeloRewardPoolEligibilityQueryKey,
  useGetCeloRewardPoolConfig, useGetCeloRewardPoolEligibility, useGetCurrentUser,
  useRecordCeloRewardPoolFunding, useRecordCeloRewardPoolRefund, useRefreshCampaignFundingQuote,
  type Campaign, type CeloRewardPoolConfig,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import i18n from '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import { FundingSuccess } from '@/components/funding-feedback';
import { formatExactDecimal } from '@/lib/locale-format';
import { runCeloFundingWithBalanceCheck } from '@/lib/celo-funding-guard';
import {
  connectCeloWallet, fundCeloCampaign, recoverCeloFunding, refundCeloReward,
  sameApprovedCeloConfig, waitForCeloTransaction, getCeloTokenBalance,
} from '@/lib/celo-reward-pool';

type Pending = { kind: 'funding' | 'withdrawal'; txHash: Hex; contractAddress: string; chainId?: number; onchainCampaignId?: number };
const HASH = /^0x[a-fA-F0-9]{64}$/;
function readPending(key: string): Pending | null {
  try {
    const record: unknown = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!record || typeof record !== 'object') return null;
    const item = record as Pending;
    return HASH.test(item.txHash) && ['funding', 'withdrawal'].includes(item.kind) &&
      /^0x[a-fA-F0-9]{40}$/.test(item.contractAddress) &&
      (item.chainId === undefined || item.chainId === 11142220 || item.chainId === 42220) ? item : null;
  } catch { return null; }
}
const explorer = (hash: string, baseUrl: string) => `${baseUrl.replace(/\/$/, '')}/tx/${hash}`;
const amount = (raw: string) => `${formatExactDecimal(formatEther(BigInt(raw)))} CELO`;

export function CeloRewardPoolPanel({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  const { isSignedIn, user } = useGGAuth();
  const client = useQueryClient();
  const account = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const admin = isSignedIn && account.data?.id === user?.id && account.data?.isAdmin === true;
  const configQuery = useGetCeloRewardPoolConfig({ query: { queryKey: getGetCeloRewardPoolConfigQueryKey(), staleTime: 15_000 } });
  const config = configQuery.data;
  const eligibility = useGetCeloRewardPoolEligibility(campaign.id, {
    query: { enabled: admin && campaign.rewardStatus === 'draft', staleTime: 15_000, queryKey: getGetCeloRewardPoolEligibilityQueryKey(campaign.id) },
  });
  const funding = useRecordCeloRewardPoolFunding();
  const withdrawal = useRecordCeloRewardPoolRefund();
  const refreshFundingQuote = useRefreshCampaignFundingQuote();
  const [deposit, setDeposit] = useState(campaign.celoTargetAmount ?? '');
  useEffect(() => { setDeposit(campaign.celoTargetAmount ?? ''); }, [campaign.id, campaign.celoTargetAmount]);
  const storeKey = `ggs:celo-pending:${campaign.id}:CELO:${(campaign.projectWallet || 'unassigned').toLowerCase()}`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storeKey));
  useEffect(() => { setPending(readPending(storeKey)); }, [storeKey]);
  const [phase, setPhase] = useState<'idle' | 'approval' | 'funding' | 'confirming'>('idle');
  const [approvalHash, setApprovalHash] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fundingConfirmed, setFundingConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState('');
  const [fundingQuote, setFundingQuote] = useState<{ celoAmount: string; expiresAt: number } | null>(null);
  const refreshedFundingExpiry = useRef(0);
  const initialQuoteRequested = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const [quoteNow, setQuoteNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setQuoteNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const quoteExpiry = fundingQuote ? (fundingQuote.expiresAt < 1_000_000_000_000 ? fundingQuote.expiresAt * 1000 : fundingQuote.expiresAt) : 0;
  const quoteSeconds = fundingQuote ? Math.max(0, Math.ceil((quoteExpiry - quoteNow) / 1000)) : 0;
  const save = (record: Pending | null) => {
    setPending(record);
    if (record) window.localStorage.setItem(storeKey, JSON.stringify(record));
    else window.localStorage.removeItem(storeKey);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
    void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetMarketplaceSummaryQueryKey() });
  };
  const sync = async (record: Pending) => {
    setBusy(true); setError(''); setPhase('confirming');
    try {
      if (!config) throw new Error(t('celo.notConfigured'));
      const pendingChainId = record.chainId ?? 11142220;
      if (pendingChainId !== config.chainId) {
        throw new Error(`This pending transaction belongs to Celo chain ${pendingChainId}. Switch the configured network back before syncing.`);
      }
      if (record.kind === 'funding') {
        const confirmed = await recoverCeloFunding(record.txHash, record.contractAddress, config);
        await funding.mutateAsync({ campaignId: campaign.id, data: confirmed });
         setMessage(t('celo.syncConfirmed'));
         setFundingConfirmed(true);
      } else {
        setFundingConfirmed(false);
        await waitForCeloTransaction(record.txHash, config);
        await withdrawal.mutateAsync({ campaignId: campaign.id, data: { txHash: record.txHash } });
         setMessage(t('celo.refundConfirmed'));
      }
      save(null); refresh();
    } catch (cause) {
       setError(`${cause instanceof Error ? cause.message : t('celo.confirmationFailed')} ${t('celo.retryWithoutSend')}`);
    } finally { setBusy(false); setPhase('idle'); }
  };
  let gross: bigint | null = null;
  try { gross = deposit.trim() ? parseEther(deposit.trim()) : null; } catch { /* invalid decimal */ }
  const directAmountValid = Boolean(campaign.usdTargetAmount) || (/^(0|[1-9]\d{0,17})(\.\d{1,4})?$/.test(deposit) && Number(deposit) >= 0.1);
  const canFund = admin && config?.ready && campaign.chainId === config.chainId && eligibility.data?.eligible && !busy &&
    !pending && gross !== null && gross > 0n && directAmountValid;
  const refreshQuoteForFunding = async () => {
    setError('');
    try {
      const quote = await refreshFundingQuote.mutateAsync({ campaignId: campaign.id });
      setDeposit(quote.celoAmount);
      setFundingQuote({ celoAmount: quote.celoAmount, expiresAt: quote.expiresAt });
      refresh();
    } catch {
      setError(t('launchFlow.quoteUnavailable'));
    }
  };
  useEffect(() => {
    if (!campaign.usdTargetAmount || fundingQuote || refreshFundingQuote.isPending ||
        initialQuoteRequested.current === campaign.id) return;
    initialQuoteRequested.current = campaign.id;
    void refreshQuoteForFunding();
  }, [campaign.id, campaign.usdTargetAmount, fundingQuote, refreshFundingQuote.isPending]);
  useEffect(() => {
    if (!campaign.usdTargetAmount || !fundingQuote || !quoteExpiry || quoteExpiry > quoteNow ||
        refreshFundingQuote.isPending || refreshedFundingExpiry.current === quoteExpiry) return;
    refreshedFundingExpiry.current = quoteExpiry;
    void refreshQuoteForFunding();
  }, [campaign.usdTargetAmount, fundingQuote, quoteExpiry, quoteNow, refreshFundingQuote.isPending]);
  const startFunding = async () => {
    if (!canFund || !config?.contractAddress || !config.protocolWallet) return;
    const contractAddress = config.contractAddress;
    const protocolWallet = config.protocolWallet;
    if (campaign.usdTargetAmount) {
      if (!fundingQuote || quoteExpiry <= Date.now()) {
        await refreshQuoteForFunding();
        return;
      }
      setDeposit(fundingQuote.celoAmount);
    }
    const currentAmount = campaign.usdTargetAmount && fundingQuote ? fundingQuote.celoAmount : deposit.trim();
    let currentGross: bigint;
    try { currentGross = parseEther(currentAmount); } catch { setError(t('launchFlow.celoRequired')); return; }
    if (currentGross <= 0n) { setError(t('launchFlow.celoRequired')); return; }
    const expectedContract = contractAddress.toLowerCase();
    const expectedProtocol = protocolWallet.toLowerCase();
    setBusy(true); setError(''); setMessage(''); setFundingConfirmed(false); setApprovalHash(''); setPhase('approval');
    try {
      const connected = await connectCeloWallet(config);
      if (campaign.usdTargetAmount && quoteExpiry <= Date.now()) {
        setBusy(false);
        setPhase('idle');
        await refreshQuoteForFunding();
        return;
      }
      const result = await runCeloFundingWithBalanceCheck({
        readBalance: () => getCeloTokenBalance(config, connected.address),
        requiredBalance: currentGross,
        insufficientBalanceMessage: balance => t('paymentDetails.balanceTooLow', {
          balance: formatExactDecimal(formatEther(balance)),
          amount: currentAmount,
        }),
        sendFundingTransaction: () => fundCeloCampaign({
          config,
          contractAddress, protocolWallet,
          amount: currentAmount, onApproval: hash => setApprovalHash(hash),
          onFundingStep: () => setPhase('funding'),
          beforeSignature: async () => {
            if (campaign.usdTargetAmount && quoteExpiry <= Date.now()) throw new Error(t('launchFlow.quoteExpired'));
            const [fresh, check] = await Promise.all([configQuery.refetch(), eligibility.refetch()]);
            if (fresh.isError || !fresh.data?.ready ||
                !sameApprovedCeloConfig(config, fresh.data) ||
                fresh.data.contractAddress?.toLowerCase() !== expectedContract ||
                fresh.data.protocolWallet?.toLowerCase() !== expectedProtocol ||
                check.isError || !check.data?.eligible) {
               throw new Error(t('celo.deploymentChanged'));
            }
            if (campaign.usdTargetAmount && quoteExpiry <= Date.now()) {
              throw new Error(t('launchFlow.quoteExpired'));
            }
          },
        }),
      });
      const record: Pending = {
        kind: 'funding', txHash: result.txHash, contractAddress: config.contractAddress, chainId: config.chainId,
      };
      save(record);
      setBusy(false);
      await sync(record);
    } catch (cause) {
       setError(cause instanceof Error ? cause.message : t('celo.depositFailed'));
      setBusy(false); setPhase('idle');
    }
  };
  const startWithdrawal = async () => {
    if (!admin || !config?.ready || campaign.chainId !== config.chainId || !config.contractAddress || !campaign.projectWallet ||
        campaign.onchainCampaignId == null || busy || pending) return;
    setBusy(true); setError(''); setMessage(''); setFundingConfirmed(false);
    try {
      const fresh = await configQuery.refetch();
      if (fresh.isError || !fresh.data?.ready || !sameApprovedCeloConfig(config, fresh.data) ||
          fresh.data.contractAddress?.toLowerCase() !== campaign.contractAddress?.toLowerCase()) {
         throw new Error(t('celo.contractChanged'));
      }
      const txHash = await refundCeloReward(config, config.contractAddress, campaign.projectWallet, campaign.onchainCampaignId);
      const record: Pending = {
        kind: 'withdrawal', txHash, contractAddress: config.contractAddress, chainId: config.chainId,
      };
      save(record);
      setBusy(false);
      await sync(record);
    } catch (cause) {
       setError(cause instanceof Error ? cause.message : t('celo.withdrawalFailed'));
      setBusy(false);
    }
  };
  const expired = campaign.claimDeadline && new Date(campaign.claimDeadline).getTime() < Date.now();
  const fundingStage = phase === 'approval' ? 0 : phase === 'funding' || phase === 'confirming' ? 1 : -1;
  return (
    <div className="mt-6 min-w-0 rounded-sm border border-accent/60 bg-accent/10 p-5" data-testid={`panel-celo-pool-${campaign.id}`}>
      <h4 className="mt-2 text-lg font-semibold">{t('celo.payouts')}</h4>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('paymentDetails.creatorExplanation')}</p>
      <p className="mt-3 text-xs text-muted-foreground" data-testid="text-celo-admin-note">{t('paymentDetails.adminPayoutNote')}</p>
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)} className="mt-4 inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-xs font-medium hover:border-foreground/30" data-testid="button-payment-details"><Info size={14} /> {t('paymentDetails.heading')}</button>
      <AnimatePresence initial={false}>
      {detailsOpen && <motion.div initial={reducedMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }} transition={{ duration: reducedMotion ? 0 : .18 }} className="mt-3 space-y-3 rounded-sm border border-border bg-card/70 p-4 text-xs text-muted-foreground" data-testid="panel-payment-details">
         {config ? <p className="font-mono uppercase tracking-wider">{config.chainName} · {t('paymentDetails.chainId')} {config.chainId}</p> : <p>{configQuery.isLoading ? t('celo.checking') : t('celo.notConfigured')}</p>}
         {config && <AddressDetail label={t('celo.contract')} address={config.contractAddress ?? t('celo.notConfigured')} copyLabel={t('paymentDetails.copyAddress')} copiedLabel={t('paymentDetails.copiedAddress')} copied={copiedAddress} onCopy={setCopiedAddress} />}
         {config && <AddressDetail label={t('celo.protocolRecipient')} address={config.protocolWallet ?? t('celo.notConfigured')} copyLabel={t('paymentDetails.copyAddress')} copiedLabel={t('paymentDetails.copiedAddress')} copied={copiedAddress} onCopy={setCopiedAddress} />}
         {config && <AddressDetail label={t('celo.contractAdmin')} address={config.ownerWallet ?? t('celo.notConfigured')} copyLabel={t('paymentDetails.copyAddress')} copiedLabel={t('paymentDetails.copiedAddress')} copied={copiedAddress} onCopy={setCopiedAddress} />}
         {config && <><a href={config.sourceVerificationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{t('celo.verifiedSource')} <ExternalLink size={12} /></a>
          <a href={config.explorerUrl} target="_blank" rel="noreferrer" className="ml-3 inline-flex items-center gap-1 text-primary hover:underline">{t('paymentDetails.blockExplorer')} <ExternalLink size={12} /></a></>}
         <p className="border-t border-border pt-3 leading-5">{t('paymentDetails.technicalDisclosure')}</p>
       </motion.div>}
      </AnimatePresence>
      {campaign.rewardStatus !== 'draft' && <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
         <div><dt className="text-muted-foreground">{t('celo.deposited')}</dt><dd className="mt-1 font-mono" data-testid="text-celo-deposited">{amount(campaign.amountDepositedRaw)}</dd></div>
         <div><dt className="text-muted-foreground">{t('celo.protocolFee')}</dt><dd className="mt-1 font-mono" data-testid="text-celo-fee">{amount(campaign.protocolFeeRaw)}</dd></div>
         <div><dt className="text-muted-foreground">{t('celo.creatorPool')}</dt><dd className="mt-1 font-mono" data-testid="text-celo-net">{amount(campaign.celoPoolRaw)}</dd></div>
         <div><dt className="text-muted-foreground">{t('celo.remainingPool')}</dt><dd className="mt-1 font-mono" data-testid="text-celo-remaining">{amount(campaign.celoRemainingRaw)}</dd></div>
      </dl>}
       {campaign.claimDeadline && <p className="mt-3 text-xs text-muted-foreground">{t('celo.payoutWindow', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(campaign.claimDeadline)) })}</p>}
       {configQuery.isLoading && <p className="mt-4 text-xs">{t('celo.checking')}</p>}
       {configQuery.isError && <p className="mt-4 text-xs text-destructive">{t('celo.verifyError')} <button type="button" onClick={() => void configQuery.refetch()} className="underline">{t('celo.retry')}</button></p>}
       {config && !config.ready && <p className="mt-4 text-xs text-destructive" data-testid="status-celo-not-ready">{t('celo.walletDisabled', { reason: config.reason })}</p>}
       {!admin && <p className="mt-4 text-xs text-muted-foreground">{t('celo.adminOnly')}</p>}
      {busy && fundingStage >= 0 && (!pending || pending.kind === 'funding') && <div className="mt-4" role="status" aria-label={phase === 'approval' ? t('celo.fundingStep1') : phase === 'funding' ? t('celo.fundingStep2') : t('celo.waiting')} data-testid={`progress-funding-${campaign.id}`}>
        <div className="mb-2 text-[11px] text-muted-foreground">{phase === 'approval' ? t('celo.approveStep') : phase === 'funding' ? t('celo.fundStep') : t('celo.waitingReceipt')}</div>
        <div className="grid grid-cols-2 gap-1" aria-hidden="true">{[0, 1].map(index => <span key={index} className="funding-step-bar"><span style={{ transform: `scaleX(${index < fundingStage ? 1 : index === fundingStage ? .5 : 0})` }} /></span>)}</div>
      </div>}
      {pending && <div className="mt-4 rounded-sm border border-primary/40 p-3 text-xs" data-testid="status-pending-celo-sync">
          {t('celo.pending')} <a href={explorer(pending.txHash, config?.explorerUrl ?? 'https://celo-sepolia.blockscout.com')} target="_blank" rel="noreferrer" className="text-primary underline">{t('celo.viewTransaction')}</a>
         <Button type="button" variant="outline" className="mt-2 block" disabled={busy} onClick={() => void sync(pending)} data-testid="button-retry-celo-sync">{t('celo.retrySync')}</Button>
      </div>}
      {admin && campaign.rewardStatus === 'draft' && !pending && <div className="mt-5">
         {eligibility.isLoading && <p className="text-xs">{t('celo.checkingEligibility')}</p>}
        {eligibility.data && !eligibility.data.eligible && <p className="mb-3 text-xs text-muted-foreground" data-testid="status-celo-ineligible">{eligibility.data.reason}</p>}
         <label className="block text-xs font-medium">{t('celo.depositLabel')}
          <Input value={campaign.usdTargetAmount && fundingQuote ? fundingQuote.celoAmount : deposit} readOnly aria-readonly="true" inputMode="decimal" placeholder={t('celo.amountPlaceholder')} className="mt-2" data-testid="input-celo-amount" />
        </label>
        {!campaign.usdTargetAmount && deposit && !directAmountValid && <p className="mt-2 text-xs text-destructive" role="status">{t('launchFlow.celoRequired')}</p>}
        {campaign.usdTargetAmount && <div className="mt-3 rounded-sm border border-border bg-card/70 p-3 text-xs" data-testid="panel-funding-quote">
          {fundingQuote && quoteSeconds > 0
            ? <p className="font-mono text-muted-foreground">{t('launchFlow.quoteCountdown', { seconds: quoteSeconds })} · {fundingQuote.celoAmount} CELO</p>
            : <p className="text-muted-foreground">{t(fundingQuote ? 'launchFlow.quoteExpired' : 'paymentDetails.refreshFundingQuote')}</p>}
          <p className="mt-2 text-muted-foreground">{t('launchFlow.valueDisclosure')}</p>
        </div>}
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
           <p className={phase === 'approval' ? 'font-semibold text-primary' : ''}>{t('celo.approveStep')}</p>
           <p className={phase === 'funding' || phase === 'confirming' ? 'font-semibold text-primary' : ''}>{t('celo.fundStep')}</p>
        </div>
         {gross !== null && gross > 0n && <p className="mt-2 font-mono text-xs text-muted-foreground">{t('celo.fee', { fee: formatExactDecimal(formatEther(gross / 10n)), net: formatExactDecimal(formatEther(gross - gross / 10n)) })}</p>}
          <Button type="button" className="mt-4" onClick={() => void startFunding()} disabled={!canFund || refreshFundingQuote.isPending} aria-busy={busy || refreshFundingQuote.isPending} data-testid="button-fund-celo">
            {phase === 'approval' ? t('celo.approving') : phase === 'funding' ? t('celo.funding') : busy ? t('celo.confirming') : refreshFundingQuote.isPending ? t('launchFlow.refreshing') : campaign.usdTargetAmount && (!fundingQuote || quoteSeconds <= 0) ? t('paymentDetails.refreshFundingQuote') : campaign.usdTargetAmount ? t('paymentDetails.confirmFunding') : t('celo.beginDeposit')} <ArrowUpRight size={15} />
        </Button>
        {approvalHash && <p className="mt-2 text-xs">{t('celo.approvalSubmitted')} <a href={explorer(approvalHash, config?.explorerUrl ?? 'https://celo-sepolia.blockscout.com')} target="_blank" rel="noreferrer" className="text-primary underline">{t('celo.viewTransaction')}</a></p>}
      </div>}
      {admin && campaign.rewardStatus !== 'draft' && <p className="mt-5 text-xs">
         {t('celo.payoutSource')} <a href="/admin/payouts" className="text-primary underline">{t('celo.payoutPage')}</a>.
      </p>}
      {admin && expired && BigInt(campaign.celoRemainingRaw) > 0n && campaign.rewardStatus !== 'closed' && campaign.rewardStatus !== 'draft' &&
        campaign.contractAddress?.toLowerCase() === config?.contractAddress?.toLowerCase() && !pending &&
        <Button className="mt-3" variant="outline" onClick={() => void startWithdrawal()} disabled={busy || !config?.ready} data-testid="button-refund-celo">
           {t('celo.withdraw')} <ArrowUpRight size={15} />
        </Button>}
      {message && (fundingConfirmed ? <FundingSuccess message={message} /> : <p className="mt-3 text-xs text-secondary" data-testid="status-celo-success">{message}</p>)}
      {error && <p className="mt-3 text-xs text-destructive" data-testid="status-celo-error">{error}</p>}
    </div>
  );
}

function AddressDetail({ label, address, copyLabel, copiedLabel, copied, onCopy }: { label: string; address: string; copyLabel: string; copiedLabel: string; copied: string; onCopy: (value: string) => void }) {
  const canCopy = /^0x[a-fA-F0-9]{40}$/.test(address);
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); onCopy(address); }
    catch { onCopy(''); }
  };
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0"><p>{label}</p><code className="mt-1 block break-all font-mono text-foreground">{address}</code></div>
    {canCopy && <button type="button" onClick={() => void copyAddress()} className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] text-foreground" aria-label={copyLabel} data-testid={`button-copy-${label.toLowerCase().replaceAll(' ', '-')}`}><Copy size={12} />{copied === address ? copiedLabel : copyLabel}</button>}
  </div>;
}
