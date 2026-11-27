import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGGAuth } from '@/components/auth';
import { Link } from 'wouter';
import { formatEther } from 'viem';
import { AlertTriangle, Check, Loader2, RefreshCw, Send, ShieldAlert } from 'lucide-react';
import {
  getCeloAdminCampaigns,
  getGetCeloAdminCampaignsQueryKey,
  getGetCurrentUserQueryKey,
  getGetMarketplaceSummaryQueryKey,
  getListCampaignsQueryKey,
  useGetCeloAdminCampaigns,
  useGetCeloRewardPoolConfig,
  useGetCurrentUser,
  useRecordCeloBatchPayout,
  type CeloAdminCampaign,
  type CeloRewardPoolConfig,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { distributeCeloBatch, sameApprovedCeloConfig, waitForCeloTransaction } from '@/lib/celo-reward-pool';
import { useTranslation } from 'react-i18next';
import { formatExactDecimal } from '@/lib/locale-format';
import i18n from '@/lib/i18n';

type Pending = { txHash: string; contractAddress: string; chainId?: number; onchainId: number; recipients: string[]; amounts: string[] };
const pendingKey = (id: number) => `ggs:celo-admin-payout:${id}`;
const HASH = /^0x[a-fA-F0-9]{64}$/;
type CeloConfigRefetch = ReturnType<typeof useGetCeloRewardPoolConfig>['refetch'];

function readPending(id: number): Pending | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(pendingKey(id)) || 'null') as Pending | null;
    return v && typeof v.txHash === 'string' && HASH.test(v.txHash) ? v : null;
  } catch {
    return null;
  }
}

const big = (v: string | undefined) => { try { return BigInt(v ?? '0'); } catch { return 0n; } };
const celo = (v: string | undefined) => {
  // Preserve all 18 decimals; a small but non-zero payout must never look like zero.
  return formatExactDecimal(formatEther(big(v)));
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());

function stage(c: CeloAdminCampaign, t: (key: string) => string) {
  if (c.rewardStatus === 'closed') return { label: t('adminDetail.stage.closed'), tone: 'bg-muted text-muted-foreground' };
  const pool = big(c.poolRaw), dist = big(c.distributedRaw);
  if (pool === 0n) return { label: t('adminDetail.stage.awaiting'), tone: 'bg-muted text-muted-foreground' };
  if (dist === 0n) return { label: t('adminDetail.stage.funded'), tone: 'bg-accent text-accent-foreground' };
  if (big(c.remainingRaw) > 0n) return { label: t('adminDetail.stage.progress'), tone: 'bg-primary text-primary-foreground' };
  return c.submissions.length > 0 && c.submissions.every(row => row.paid)
    ? { label: t('adminDetail.stage.paid'), tone: 'bg-secondary text-secondary-foreground' }
    : { label: t('adminDetail.stage.exhausted'), tone: 'bg-muted text-muted-foreground' };
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`border-l-2 py-0.5 pl-3 ${strong ? 'border-primary' : 'border-border'}`}>
      <p className="text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-lg tracking-[-.04em]">{value} <span className="text-[10px] text-muted-foreground">CELO</span></p>
    </div>
  );
}

function CampaignCard({ c, config, refreshConfig }: {
  c: CeloAdminCampaign;
  config?: CeloRewardPoolConfig;
  refreshConfig: CeloConfigRefetch;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const record = useRecordCeloBatchPayout();
  const recordRef = useRef(record.mutateAsync);
  recordRef.current = record.mutateAsync;
  const [busy, setBusy] = useState<'idle' | 'checking' | 'signing' | 'confirming' | 'syncing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => (typeof window === 'undefined' ? null : readPending(c.id)));
  const running = useRef(false);
  const sending = useRef(false);
  const st = stage(c, t);

  const finish = useCallback(async (p: Pending) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      setBusy('confirming');
      const refreshedConfig = await refreshConfig();
      const approvedConfig = refreshedConfig.data as CeloRewardPoolConfig | undefined;
      if (refreshedConfig.isError || !approvedConfig?.ready || !approvedConfig.contractAddress) {
        throw new Error(approvedConfig?.reason ?? t('celo.notConfigured'));
      }
      if (config && !sameApprovedCeloConfig(config, approvedConfig)) {
        throw new Error(t('celo.deploymentChanged'));
      }
      if ((p.chainId ?? 11142220) !== approvedConfig.chainId ||
          p.contractAddress.toLowerCase() !== approvedConfig.contractAddress.toLowerCase()) {
        throw new Error(`This pending transaction belongs to Celo chain ${p.chainId ?? 11142220}. Switch the configured network back before syncing.`);
      }
      await waitForCeloTransaction(p.txHash as `0x${string}`, approvedConfig);
      setBusy('syncing');
      await recordRef.current({ campaignId: c.id, data: { txHash: p.txHash } });
      window.localStorage.removeItem(pendingKey(c.id));
      setPending(null);
      setDone(p.txHash);
      void client.invalidateQueries({ queryKey: getGetCeloAdminCampaignsQueryKey() });
      void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMarketplaceSummaryQueryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('adminDetail.confirmRecordError'));
    } finally {
      running.current = false;
      setBusy('idle');
    }
  }, [c.id, client, config, refreshConfig, t]);

  useEffect(() => {
    const p = readPending(c.id);
    if (p) { setPending(p); void finish(p); }
  }, [c.id, finish]);

  const send = async () => {
    if (sending.current || busy !== 'idle') return;
    if (pending) return void finish(pending);
    setError(null);
    if (!config?.ready || !c.eligible || !c.contractAddress || c.onchainCampaignId === null || !c.recipients.length || c.recipients.length !== c.amounts.length || !config.ownerWallet) {
      return setError(c.reason || t('adminDetail.ineligible'));
    }
    sending.current = true;
    try {
      setBusy('checking');
      const fresh = (await client.fetchQuery({ queryKey: getGetCeloAdminCampaignsQueryKey(), queryFn: ({ signal }) => getCeloAdminCampaigns({ signal }), staleTime: 0 })).find((x) => x.id === c.id);
      if (!fresh || !fresh.eligible || !fresh.contractAddress || fresh.onchainCampaignId === null) throw new Error(fresh?.reason || t('adminDetail.noLongerEligible'));
      if (fresh.contractAddress.toLowerCase() !== c.contractAddress.toLowerCase() || fresh.onchainCampaignId !== c.onchainCampaignId || !same(fresh.recipients, c.recipients) || !same(fresh.amounts, c.amounts)) {
        throw new Error(t('adminDetail.previewChanged'));
      }
      const refreshedConfig = await refreshConfig();
      const approvedConfig = refreshedConfig.data as CeloRewardPoolConfig | undefined;
      if (refreshedConfig.isError || !approvedConfig?.ready || !approvedConfig.contractAddress ||
          !sameApprovedCeloConfig(config, approvedConfig) ||
          fresh.contractAddress.toLowerCase() !== approvedConfig.contractAddress.toLowerCase()) {
        throw new Error(approvedConfig?.reason ?? t('celo.deploymentChanged'));
      }
      setBusy('signing');
      const txHash = await distributeCeloBatch(approvedConfig, fresh.contractAddress, fresh.onchainCampaignId, fresh.recipients, fresh.amounts, approvedConfig.ownerWallet ?? '');
      const p: Pending = {
        txHash, contractAddress: fresh.contractAddress, chainId: approvedConfig.chainId,
        onchainId: fresh.onchainCampaignId, recipients: fresh.recipients, amounts: fresh.amounts,
      };
      setPending(p);
      window.localStorage.setItem(pendingKey(c.id), JSON.stringify(p));
      setBusy('idle');
      await finish(p);
    } catch (e) {
      setBusy('idle');
      setError(e instanceof Error ? e.message : t('adminDetail.payoutFailed'));
    } finally { sending.current = false; }
  };

  const label = { idle: pending ? t('admin.resume') : t('admin.send'), checking: t('admin.checkingPreview'), signing: t('admin.signing'), confirming: t('admin.confirming'), syncing: t('admin.recording') }[busy];
  const unpaid = c.submissions.filter((s) => !s.paid).length;

  return (
    <article className="rounded-sm border border-border bg-card" data-testid={`card-payout-${c.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
           <p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{t('adminDetail.campaign')} {c.id}{c.onchainCampaignId !== null && ` / ${t('adminDetail.chainId')} ${c.onchainCampaignId}`}</p>
          <h3 className="mt-1 break-words text-xl font-semibold tracking-[-.03em]">{c.name}</h3>
          {c.contractAddress && <p className="mt-1 font-mono text-xs text-muted-foreground" data-testid={`text-contract-${c.id}`}>{short(c.contractAddress)}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${st.tone}`} data-testid={`status-stage-${c.id}`}>{st.label}</span>
      </header>
      <div className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-5">
         <Stat label={t('admin.deposited')} value={celo(c.grossRaw)} />
         <Stat label={t('admin.fee')} value={celo(c.feeRaw)} />
         <Stat label={t('admin.pool')} value={celo(c.poolRaw)} />
         <Stat label={t('admin.distributed')} value={celo(c.distributedRaw)} />
         <Stat label={t('admin.remaining')} value={celo(c.remainingRaw)} strong />
      </div>
      <div className="px-5 pb-2">
        <div className="hidden grid-cols-[1fr_90px_1fr_90px] gap-3 border-b border-border pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
           <span>{t('admin.creator')}</span><span className="text-right">{t('admin.share')}</span><span className="text-right">{t('admin.payout')}</span><span className="text-right">{t('admin.status')}</span>
        </div>
         {c.submissions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('admin.noSubmissions')}</p>}
        {c.submissions.map((s) => (
          <div key={s.id} className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border/60 py-3 text-sm last:border-0 sm:grid-cols-[1fr_90px_1fr_90px]" data-testid={`row-creator-${s.id}`}>
            <div className="min-w-0"><p className="truncate font-medium">{s.handle}</p><p className="font-mono text-[11px] text-muted-foreground">{short(s.walletAddress)}</p></div>
            <p className="text-right font-mono">{new Intl.NumberFormat(i18n.resolvedLanguage || 'en').format(s.xp)} <span className="text-muted-foreground">/ {new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.totalXp > 0 ? s.xp / c.totalXp : 0)}</span></p>
            <p className="break-all font-mono sm:text-right">{celo(s.payoutRaw)}</p>
             <p className="text-right"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${s.paid ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'}`}>{s.paid && <Check size={10} />}{s.paid ? t('admin.paid') : t('admin.unpaid')}</span></p>
          </div>
        ))}
      </div>
      <footer className="space-y-3 border-t border-border p-5">
         {!c.eligible && <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-reason-${c.id}`}><AlertTriangle size={15} className="mt-0.5 shrink-0" />{c.reason || t('admin.notEligible')}</p>}
         {pending && <p className="break-all font-mono text-[11px] text-muted-foreground" data-testid={`text-pending-${c.id}`}>{t('adminDetail.pendingTx')} {pending.txHash}</p>}
         {done && <p className="break-all text-sm text-secondary-foreground" data-testid={`status-success-${c.id}`}>{t('admin.confirmed')} {done}</p>}
        {error && <p className="text-sm text-destructive" role="alert" data-testid={`status-error-${c.id}`}>{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
           <Button onClick={() => void send()} disabled={busy !== 'idle' || (!pending && (!c.eligible || !config?.ready || !c.recipients.length))} data-testid={`button-send-${c.id}`}>
            {busy === 'idle' ? <Send size={15} /> : <Loader2 size={15} className="animate-spin" />} {label}
          </Button>
           <span className="text-xs text-muted-foreground">{t('admin.recipientBatch', { count: c.recipients.length, unpaid })}</span>
        </div>
      </footer>
    </article>
  );
}

function Gate({ title, body, signIn = false }: { title: string; body: string; signIn?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg rounded-sm border border-border bg-card p-8 text-center" data-testid="status-gate">
      <ShieldAlert className="mx-auto text-primary" />
      <h1 className="mt-4 text-2xl font-semibold tracking-[-.04em]">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {signIn && <Button asChild className="mt-5 mr-3"><Link href="/sign-in">{t('auth.signInFirst')}</Link></Button>}
       <Button asChild className="mt-5" variant="outline"><Link href="/">{t('adminDetail.back')}</Link></Button>
    </div>
  );
}

export function CeloAdminDashboard() {
  const { t } = useTranslation();
  const { isSignedIn, isLoaded, user } = useGGAuth();
  const account = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const isAdmin = isSignedIn && account.data?.id === user?.id && account.data?.isAdmin === true;
  const config = useGetCeloRewardPoolConfig();
  const list = useGetCeloAdminCampaigns({ query: { enabled: isAdmin, queryKey: getGetCeloAdminCampaignsQueryKey(), refetchOnMount: 'always', refetchInterval: 15_000, retry: false } });
  const campaigns = useMemo(() => list.isError ? [] : list.data ?? [], [list.data, list.isError]);

  if (!isLoaded || (isSignedIn && account.isLoading)) return <div className="space-y-3" data-testid="status-loading">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-sm bg-muted" />)}</div>;
  if (!isSignedIn) return <Gate title={t('admin.signedOut')} body={t('admin.signInBody')} signIn />;
  if (!isAdmin) return <Gate title={t('admin.forbidden')} body={t('admin.gateBody')} />;

  const ready = config.data?.ready === true;
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.18em] text-primary"><span className="h-px w-6 bg-primary" /> {t('admin.eyebrow')}</p>
          <h1 className="text-balance text-4xl font-semibold leading-[1] tracking-[-.05em] sm:text-5xl">{t('admin.title')}</h1>
          <p className="mt-4 text-[15px] leading-7 text-muted-foreground">{t('admin.intro')}</p>
        </div>
       <Button variant="outline" onClick={() => { void list.refetch(); void config.refetch(); }} disabled={list.isFetching} data-testid="button-refresh"><RefreshCw size={14} className={list.isFetching ? 'animate-spin' : ''} /> {t('admin.refresh')}</Button>
      </div>
      <div className={`rounded-sm border p-4 text-sm ${ready ? 'border-border bg-card' : 'border-destructive/30 bg-destructive/5'}`} data-testid="status-contract">
         {config.isLoading ? t('admin.loading') : config.isError ? t('admin.configError') : ready
          ? <>{t('adminDetail.contractReady', { chain: config.data?.chainName })} {t('adminDetail.owner')} {config.data?.ownerWallet ? <span className="font-mono">{short(config.data.ownerWallet)}</span> : t('adminDetail.unknown')}.</>
          : <>{t('admin.notReady')} {config.data?.reason ?? ''} {t('admin.disabled')}</>}
      </div>
      {list.isLoading && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-sm bg-muted" />)}</div>}
      {list.isError && (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-5" data-testid="status-error">
           <p className="text-sm font-medium">{t('admin.listError')}</p>
           <Button className="mt-3" size="sm" variant="outline" onClick={() => void list.refetch()} data-testid="button-retry">{t('admin.retry')}</Button>
        </div>
      )}
       {!list.isLoading && !list.isError && campaigns.length === 0 && <div className="border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="empty-campaigns">{t('admin.empty')}</div>}
       <div className="space-y-6">
          {campaigns.map((c) => <CampaignCard key={c.id} c={c} config={config.data} refreshConfig={config.refetch} />)}
      </div>
    </div>
  );
}

export default CeloAdminDashboard;
