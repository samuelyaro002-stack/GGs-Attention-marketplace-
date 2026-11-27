import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { animate, AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { z } from 'zod';
import { parseEther } from 'viem';
import { useGGAuth } from '@/components/auth';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  Radar,
  Send,
  Trophy,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  getGetCampaignLeaderboardQueryKey,
  getGetCurrentUserQueryKey,
  getGetCampaignQueryKey,
  getGetMarketplaceSummaryQueryKey,
  getGetRewardPoolClaimQueryKey,
  getGetRewardPoolDistributionQueryKey,
  getGetRewardPoolEligibilityQueryKey,
  getListCampaignsQueryKey,
  SubmissionInputAccountAge,
  SubmissionInputPlatform,
  useCreateSubmission,
  useGetCampaign,
  useGetCampaignLeaderboard,
  useGetCeloRewardPoolConfig,
  useGetCurrentUser,
  useGetRewardPoolClaim,
  useGetRewardPoolConfig,
  useGetRewardPoolDistribution,
  useGetRewardPoolEligibility,
  useGetMarketplaceSummary,
  useListCampaigns,
  useRecordRewardPoolClaim,
  useRecordRewardPoolFunding,
  useRecordRewardPoolRefund,
  useRecordRewardPoolRoot,
  useRecordRewardPoolSwap,
  type Campaign,
  type LeaderboardRow,
  type Submission,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import DailyGPage from '@/pages/daily-g';
import { PrivacyPage, TermsPage } from '@/pages/legal';
import { BrandAbout, BrandHome } from '@/pages/brand-site';
import { AccountControls, AccountPage, AccountRequired, AuthCacheInvalidator, GGAuthProvider, SignInPage, SignUpPage, UserPortal, basePath } from '@/components/auth';
import {
  CLAIM_WINDOW_SECONDS,
  REWARD_POOL_CONTRACT_ADDRESS,
  claimOnchainReward,
  connectWallet,
  createOnchainCampaign,
  finalizeOnchainSwap,
  formatGdollarAmount,
  isRewardPoolConfigured,
  publishOnchainRoot,
  quoteOnchainSwap,
  withdrawUnclaimedOnchainReward,
} from '@/lib/reward-pool';
import { CeloRewardPoolPanel } from '@/components/celo-campaign';
import { CeloAdminDashboard } from '@/components/celo-admin-dashboard';
import { CampaignPool } from '@/components/campaign-pool';
import { celoPoolDisplay as rawCeloPoolDisplay, celoRewardEstimate as rawCeloRewardEstimate } from '@/lib/campaign-pool';
import { connectCeloAddress } from '@/lib/celo-reward-pool';
import { isRewardSwapQuoteFresh, type RewardSwapQuote } from '@/lib/reward-quote';
import { SitePreferences } from '@/components/site-preferences';
import i18n from '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import CampaignLaunch from '@/pages/campaign-launch';

const queryClient = new QueryClient();

const createSubmissionSchema = (t: (key: string) => string) => z.object({
  campaignId: z.coerce.number<number | string>().positive(t('validation.chooseCampaign')),
  handle: z.string().trim().min(2, t('validation.creatorHandle')).max(40),
  platform: z.enum(['X (Twitter)', 'TikTok', 'Medium']),
  link: z.string().trim().url(t('validation.postUrl')).max(300).refine((value) => /^https?:\/\//i.test(value), t('validation.httpUrl')),
  accountAge: z.enum(['under-30-days', '1-6-months', 'established']),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, t('validation.wallet')),
});
type SubmissionFormValues = z.output<ReturnType<typeof createSubmissionSchema>>;

const money = (value: number | undefined) =>
  new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value ?? 0);
const number = (value: number | undefined) => new Intl.NumberFormat(i18n.resolvedLanguage || 'en').format(value ?? 0);
const celoPoolDisplay = (campaign: Parameters<typeof rawCeloPoolDisplay>[0]) => rawCeloPoolDisplay(campaign, i18n.t('motionUI.legacyTarget'));
const celoRewardEstimate = (campaign: Parameters<typeof rawCeloRewardEstimate>[0], xp: number, totalXp: number) => rawCeloRewardEstimate(campaign, xp, totalXp, i18n.t('campaignPool.notFunded'));
const dateLabel = (value: string | undefined, recently: string) =>
  value ? new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', { month: 'short', day: 'numeric' }).format(new Date(value)) : recently;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3" data-testid="link-brand">
      <span className="relative grid size-9 place-items-center rounded-sm bg-primary text-primary-foreground transition-transform group-hover:-rotate-6">
        <span className="absolute size-3 rotate-45 border-2 border-current" />
        <span className="absolute h-4 w-0.5 bg-current" />
      </span>
      {!compact && <span className="text-[15px] font-bold tracking-[-0.03em]">GG<span className="text-primary">.</span>ATTENTION</span>}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const { isSignedIn, user } = useGGAuth();
  const account = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const nav = [
    { href: '/overview', label: t('pages.overview'), testId: 'overview', icon: LayoutDashboard },
    { href: '/projects', label: t('pages.projects'), testId: 'projects', icon: BriefcaseBusiness },
    { href: '/creators', label: t('pages.creators'), testId: 'creators', icon: Users },
    { href: '/leaderboard', label: t('pages.leaderboard'), testId: 'leaderboard', icon: Trophy },
    { href: '/daily-g', label: t('pages.daily'), testId: 'daily g$', icon: CircleDollarSign },
    ...(isSignedIn ? [{ href: '/account', label: t('pages.account'), testId: 'account', icon: UserRound }] : []),
    ...(isSignedIn && account.data?.id === user?.id && account.data?.isAdmin ? [{ href: '/admin/payouts', label: t('pagesExtra.payouts'), testId: 'payouts', icon: CircleDollarSign }] : []),
  ];
  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <header className={`market-header sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-md ${compact ? 'is-compact' : ''}`}>
        <div className={`mx-auto flex ${compact ? 'h-[58px]' : 'h-[68px]'} max-w-[1440px] items-center justify-between px-5 lg:px-10`}>
          <BrandMark />
          <nav className="hidden items-center gap-1 xl:flex" aria-label={t('nav.main')}>
            {nav.map(({ href, label, testId, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                data-testid={`link-nav-${testId}`}
                className={`flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
                  location === href ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon size={15} strokeWidth={1.8} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex xl:hidden">
            <SitePreferences compact />
            <AccountControls />
          </div>
          <div className="hidden items-center gap-3 xl:flex">
            <SitePreferences compact />
            <AccountControls />
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="grid size-9 place-items-center rounded-sm border border-border xl:hidden"
            data-testid="button-toggle-menu"
            aria-label={t(mobileOpen ? 'nav.menuClose' : 'nav.menuOpen')}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        <AnimatePresence initial={false}>
        {mobileOpen && <motion.button key="app-backdrop" type="button" className="mobile-menu-backdrop xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} aria-label={t('nav.menuClose')} data-testid="button-menu-backdrop" />}
        {mobileOpen && (
          <motion.div key="app-mobile-navigation" initial={reduced ? false : { opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -5 }} transition={{ duration: reduced ? 0 : .18 }} className="relative z-10 border-t border-border bg-card px-5 py-3 xl:hidden">
            {nav.map(({ href, label, testId, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                data-testid={`link-mobile-${testId}`}
                className={`flex items-center gap-3 border-b border-border/70 py-3 text-sm font-medium last:border-0 ${
                  location === href ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon size={16} /> {label}
              </Link>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 py-3 md:hidden"><SitePreferences /><AccountControls /></div>
          </motion.div>
        )}
        </AnimatePresence>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10 lg:py-12">{children}</main>
      <footer className="mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-border/70 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <span className="font-mono tracking-tight">{t('legal.back')}</span>
        <div className="flex flex-wrap items-center gap-4"><Link href="/privacy" className="hover:text-foreground">{t('footer.privacy')}</Link><Link href="/terms" className="hover:text-foreground">{t('footer.terms')}</Link><span>{t('footer.tagline')}</span></div>
      </footer>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: ReactNode; description: string; action?: ReactNode }) {
  return (
    <div className="mb-9 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="enter-up max-w-2xl">
        <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.18em] text-primary">
          <span className="h-px w-6 bg-primary" /> {eyebrow}
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-[.98] tracking-[-.055em] sm:text-5xl lg:text-[4.5rem]">{title}</h1>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted-foreground">{description}</p>
      </div>
      {action && <div className="enter-up enter-up-delay-1 shrink-0">{action}</div>}
    </div>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-muted ${className}`} />;
}

function QueryError({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3 rounded-sm border border-destructive/30 bg-destructive/5 p-5" data-testid="status-error">
       <p className="text-sm font-medium">{t('market.signalDropped')}</p>
       <Button variant="outline" size="sm" onClick={retry} data-testid="button-retry">{t('market.retry')}</Button>
    </div>
  );
}

function Metric({ icon: Icon, label, value, numericValue, formatter = number, accent = false, testId }: { icon: typeof Activity; label: string; value: string; numericValue?: number; formatter?: (value: number) => string; accent?: boolean; testId?: string }) {
  const [display, setDisplay] = useState(value);
  const played = useRef(false);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || numericValue === undefined || reduced || played.current) { setDisplay(value); return; }
    played.current = true;
    const controls = animate(0, numericValue, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (current) => setDisplay(formatter(Math.round(current))),
      onComplete: () => setDisplay(value),
    });
    return () => controls.stop();
  }, [value, numericValue, formatter, visible, reduced]);
  return (
      <div ref={element} className={`border-l-2 py-1 pl-4 ${accent ? 'border-primary' : 'border-border'}`} data-testid={`metric-${testId ?? label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[.14em] text-muted-foreground"><Icon size={14} /> {label}</div>
      <div className="font-mono text-2xl font-medium tracking-[-.06em] sm:text-3xl">{display}</div>
    </div>
  );
}

function Overview() {
  const { t } = useTranslation();
  const summaryQuery = useGetMarketplaceSummary();
  const campaignsQuery = useListCampaigns({ query: { queryKey: getListCampaignsQueryKey(), refetchInterval: 15_000 } });
  const summary = summaryQuery.data;
  const featured = useMemo(() => campaignsQuery.isError ? [] : (campaignsQuery.data ?? []).slice(0, 3), [campaignsQuery.data, campaignsQuery.isError]);
  return (
    <div>
      <section className="grid-paper relative overflow-hidden rounded-sm border border-border bg-card px-6 py-10 sm:px-10 lg:px-16 lg:py-16">
        <div className="absolute -right-16 -top-20 size-64 rounded-full border-[34px] border-primary/15" />
        <div className="absolute -right-4 top-20 size-20 rounded-full bg-accent/70 blur-[1px]" />
        <div className="relative max-w-4xl enter-up">
          <p className="mb-7 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.2em] text-primary"><span className="live-dot size-2 rounded-full bg-primary" /> {t('market.overviewEyebrow')}</p>
          <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[.91] tracking-[-.07em] sm:text-7xl lg:text-[7.3rem]">{t('market.overviewTitle')}<br /><span className="text-primary">{t('market.overviewAccent')}</span></h1>
           <p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">{t('market.overviewDescription')}</p>
          <div className="mt-9 flex flex-wrap gap-3">
             <Button asChild size="lg" data-testid="button-explore-campaigns"><Link href="/projects">{t('market.explore')} <ArrowRight size={16} /></Link></Button>
             <Button asChild variant="outline" size="lg" data-testid="button-submit-as-creator"><Link href="/creators">{t('market.submitPost')}</Link></Button>
          </div>
        </div>
        <div className="relative mt-14 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-7 border-t border-border/80 pt-7 sm:grid-cols-4 lg:mt-20">
          <Metric icon={BriefcaseBusiness} label={t('market.activeCampaigns')} testId="active-campaigns" numericValue={summary?.activeCampaigns} value={summaryQuery.isLoading ? '…' : number(summary?.activeCampaigns)} accent />
          <Metric icon={Users} label={t('market.creatorsIn')} testId="creators-in" numericValue={summary?.creatorsSubmitted} value={summaryQuery.isLoading ? '…' : number(summary?.creatorsSubmitted)} />
          <Metric icon={Zap} label={t('market.xpAwarded')} testId="xp-awarded" numericValue={summary?.totalXp} value={summaryQuery.isLoading ? '…' : number(summary?.totalXp)} />
          <Metric icon={CircleDollarSign} label={t('market.pools')} testId="g$-pools-(usd-est.)" numericValue={summary?.totalPool} formatter={money} value={summaryQuery.isLoading ? '…' : money(summary?.totalPool)} />
        </div>
      </section>
      <p className="mt-5 rounded-sm border border-border bg-card p-4 text-xs leading-6 text-muted-foreground" data-testid="notice-demo-scoring">{t('market.demoNotice')}</p>
      <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_360px]">
        <section className="enter-up enter-up-delay-1">
             <div className="mb-5 flex items-end justify-between border-b border-border pb-4">
             <div><p className="font-mono text-[11px] uppercase tracking-[.18em] text-muted-foreground">{t('market.liveBoard')}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">{t('market.momentum')}</h2></div>
             <Link href="/projects" className="hidden items-center gap-1 text-xs font-medium text-primary sm:flex" data-testid="link-view-all-campaigns">{t('market.viewAll')} <ArrowRight size={14} /></Link>
          </div>
          {campaignsQuery.isLoading && <div className="space-y-3"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-28" /></div>}
          {campaignsQuery.isError && <QueryError retry={() => void campaignsQuery.refetch()} />}
           {!campaignsQuery.isLoading && !campaignsQuery.isError && featured.length === 0 && <div className="border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="empty-campaigns">{t('market.emptyCampaigns')}</div>}
          <div className="space-y-3">
            {featured.map((campaign, index) => <CampaignRow key={campaign.id} campaign={campaign} index={index} />)}
          </div>
        </section>
        <section className="enter-up enter-up-delay-2">
           <div className="mb-5 border-b border-border pb-4"><p className="font-mono text-[11px] uppercase tracking-[.18em] text-muted-foreground">{t('market.tape')}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">{t('market.recent')}</h2></div>
          {summaryQuery.isError && <QueryError retry={() => void summaryQuery.refetch()} />}
          <div className="relative ml-2 border-l border-border pl-6">
            {(summary?.recentActivity ?? []).length === 0 && !summaryQuery.isLoading && <p className="py-4 text-sm text-muted-foreground" data-testid="empty-activity">{t('market.emptyActivity')}</p>}
            {(summary?.recentActivity ?? []).map((item, index) => (
              <div key={`${item.createdAt}-${index}`} className="relative mb-7 last:mb-0" data-testid={`activity-item-${index}`}>
                <span className="absolute -left-[30px] top-1 size-2 rounded-full border-2 border-background bg-primary" />
                <p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.kind === 'campaign' ? t('motionUI.activityCampaign') : item.kind === 'submission' ? t('motionUI.activitySubmission') : item.detail}</p><p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">{dateLabel(item.createdAt, t('common.recently'))}</p>
              </div>
            ))}
            {summaryQuery.isLoading && <><SkeletonBlock className="mb-7 h-12" /><SkeletonBlock className="h-12" /></>}
          </div>
        </section>
      </div>
      <section className="mt-20 border-t border-border pt-10">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            ['01', t('projectUI.principle1'), t('projectUI.principle1Copy')],
            ['02', t('projectUI.principle2'), t('projectUI.principle2Copy')],
            ['03', t('projectUI.principle3'), t('projectUI.principle3Copy')],
          ].map(([num, title, copy]) => <div key={num} className="group" data-testid={`principle-${num}`}><p className="font-mono text-xs text-primary">{num}</p><h3 className="mt-4 text-xl font-semibold tracking-[-.035em]">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p></div>)}
        </div>
      </section>
    </div>
  );
}

function CampaignRow({ campaign, index = 0, onSelect }: { campaign: Campaign; index?: number; onSelect?: (id: number) => void }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-4"><span className="mt-1 font-mono text-xs text-muted-foreground">0{index + 1}</span><div className="min-w-0"><h3 className="flex items-center gap-2 truncate font-semibold tracking-[-.02em]"><span className="truncate">{campaign.name}</span><span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider" data-testid={`badge-asset-${campaign.id}`}>{campaign.rewardAsset === 'CELO' ? 'CELO Sepolia' : 'G$'}</span></h3><p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{campaign.brief || t('projectUI.defaultBrief')}</p></div></div>
      <div className={`flex items-center gap-3 text-right sm:gap-5 ${campaign.rewardAsset === 'CELO' ? 'min-w-0' : 'shrink-0'}`}><div className={campaign.rewardAsset === 'CELO' ? 'min-w-0 [overflow-wrap:anywhere]' : 'whitespace-nowrap'}><CampaignPool campaign={campaign} /></div><div className="hidden sm:block"><p className="font-mono text-sm">{number(campaign.submissionsCount)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t('projectUI.posts')}</p></div><ArrowUpRight size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>
    </>
  );
  return <motion.div layout="position" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, delay: Math.min(index, 5) * .06 }}>
  {onSelect ? (
    <button type="button" onClick={() => onSelect(campaign.id)} className={`motion-card group flex w-full justify-between gap-5 rounded-sm border border-border bg-card p-5 text-left transition-transform hover:border-foreground/30 ${campaign.rewardAsset === 'CELO' ? 'flex-col items-stretch sm:flex-row sm:items-center' : 'items-center'}`} data-testid={`button-campaign-${campaign.id}`}>{content}</button>
  ) : (
    <Link href={`/projects?campaign=${campaign.id}`} className={`motion-card group flex justify-between gap-5 rounded-sm border border-border bg-card p-5 transition-transform hover:border-foreground/30 ${campaign.rewardAsset === 'CELO' ? 'flex-col items-stretch sm:flex-row sm:items-center' : 'items-center'}`} data-testid={`link-campaign-${campaign.id}`}>{content}</Link>
  )}
  </motion.div>;
}

type PendingRewardSync =
  | {
      kind: 'funding';
      data: { onchainCampaignId: number; contractAddress: string; projectWallet: string; ethFundedRaw: string; txHash: string };
    }
  | { kind: 'swap'; data: { gdPoolRaw: string; txHash: string } }
  | { kind: 'root'; data: { merkleRoot: string; txHash: string } }
  | { kind: 'refund'; data: { contractAddress: string; txHash: string } };

function readPendingRewardSync(key: string): PendingRewardSync | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as { kind?: string; data?: Record<string, unknown> };
    const data = record.data;
    const isHash = (item: unknown) => typeof item === 'string' && /^0x[a-fA-F0-9]{64}$/.test(item);
    const isAddressValue = (item: unknown) => typeof item === 'string' && /^0x[a-fA-F0-9]{40}$/.test(item);
    if (!data || !isHash(data.txHash)) return null;
    if (
      record.kind === 'funding' &&
      typeof data.onchainCampaignId === 'number' &&
      Number.isSafeInteger(data.onchainCampaignId) &&
      Number(data.onchainCampaignId) >= 0 &&
      isAddressValue(data.contractAddress) &&
      isAddressValue(data.projectWallet) &&
      typeof data.ethFundedRaw === 'string' &&
      /^[1-9][0-9]*$/.test(data.ethFundedRaw)
    ) return record as PendingRewardSync;
    if (
      record.kind === 'swap' &&
      typeof data.gdPoolRaw === 'string' &&
      /^[1-9][0-9]*$/.test(data.gdPoolRaw)
    ) return record as PendingRewardSync;
    if (
      record.kind === 'root' &&
      typeof data.merkleRoot === 'string' &&
      /^0x[a-fA-F0-9]{64}$/.test(data.merkleRoot) &&
      !/^0x0{64}$/i.test(data.merkleRoot)
    ) return record as PendingRewardSync;
    if (record.kind === 'refund' && isAddressValue(data.contractAddress)) {
      return record as PendingRewardSync;
    }
  } catch {
    // Bad local recovery data must never block the campaign UI.
  }
  return null;
}

type PendingClaimSync = {
  walletAddress: string;
  amountRaw: string;
  txHash: string;
};

function readPendingClaimSync(key: string): PendingClaimSync | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<PendingClaimSync>;
    if (
      typeof record.walletAddress === 'string' &&
      /^0x[a-fA-F0-9]{40}$/.test(record.walletAddress) &&
      typeof record.amountRaw === 'string' &&
      /^[1-9][0-9]*$/.test(record.amountRaw) &&
      typeof record.txHash === 'string' &&
      /^0x[a-fA-F0-9]{64}$/.test(record.txHash)
    ) return record as PendingClaimSync;
  } catch {
    // Invalid local recovery data should not block wallet connection or claiming.
  }
  return null;
}

function RewardPoolPanel({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { isSignedIn } = useGGAuth();
  const accountQuery = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const isAdmin = accountQuery.data?.isAdmin === true;
  const eligibilityQuery = useGetRewardPoolEligibility(campaign.id, {
    query: {
      queryKey: getGetRewardPoolEligibilityQueryKey(campaign.id),
      enabled: isAdmin && campaign.rewardStatus === 'draft',
    },
  });
  const configQuery = useGetRewardPoolConfig();
  const fundingMutation = useRecordRewardPoolFunding();
  const swapMutation = useRecordRewardPoolSwap();
  const rootMutation = useRecordRewardPoolRoot();
  const refundMutation = useRecordRewardPoolRefund();
  const distributionQuery = useGetRewardPoolDistribution(campaign.id, {
    query: {
      enabled: campaign.rewardStatus === 'swapped' || campaign.rewardStatus === 'root-published',
      queryKey: getGetRewardPoolDistributionQueryKey(campaign.id),
    },
  });
  const [celoAmount, setCeloAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState('');
  const [swapQuote, setSwapQuote] = useState<RewardSwapQuote | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [pendingAction, setPendingAction] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pendingSyncKey = `ggs:reward-pool-pending-sync:${campaign.id}`;
  const [pendingSync, setPendingSync] = useState<PendingRewardSync | null>(
    () => readPendingRewardSync(pendingSyncKey),
  );
  useEffect(() => {
    setPendingSync(readPendingRewardSync(pendingSyncKey));
  }, [pendingSyncKey]);
  const configured = isRewardPoolConfigured() && Boolean(configQuery.data?.ready) && configQuery.data?.contractAddress?.toLowerCase() === REWARD_POOL_CONTRACT_ADDRESS.toLowerCase();
  const claimDeadline = campaign.claimDeadline ? new Date(campaign.claimDeadline).getTime() : null;
  const claimWindowExpired = claimDeadline !== null && now > claimDeadline;
  const quoteFresh = swapQuote !== null && isRewardSwapQuoteFresh(swapQuote, now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
    void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetRewardPoolDistributionQueryKey(campaign.id) });
  };

  const storePendingSync = (record: PendingRewardSync) => {
    setPendingSync(record);
    try {
      window.localStorage.setItem(pendingSyncKey, JSON.stringify(record));
    } catch {
      // Keep the in-memory recovery action available if browser storage is blocked.
    }
  };

  const clearPendingSync = () => {
    setPendingSync(null);
    try {
      window.localStorage.removeItem(pendingSyncKey);
    } catch {
      // The transaction record is still cleared from this live component.
    }
  };

  const syncPending = async (record: PendingRewardSync) => {
    setPendingAction(true);
    setActionError('');
    try {
      if (record.kind === 'funding') {
        await fundingMutation.mutateAsync({ campaignId: campaign.id, data: record.data });
         setActionMessage(t('rewardPool.syncFunding'));
      } else if (record.kind === 'swap') {
        await swapMutation.mutateAsync({ campaignId: campaign.id, data: record.data });
         setActionMessage(t('rewardPool.syncSwap'));
      } else if (record.kind === 'root') {
        await rootMutation.mutateAsync({ campaignId: campaign.id, data: record.data });
         setActionMessage(t('rewardPool.syncRoot'));
      } else {
        await refundMutation.mutateAsync({ campaignId: campaign.id, data: record.data });
         setActionMessage(t('rewardPool.syncRefund'));
      }
      clearPendingSync();
      refresh();
    } catch (error) {
      setActionError(
         `${error instanceof Error ? error.message : t('rewardPool.marketplaceError')} ${t('rewardPool.syncError')}`,
      );
    } finally {
      setPendingAction(false);
    }
  };

  const fund = async () => {
    if (!configured || !isAdmin || pendingAction || pendingSync) return;
    setPendingAction(true);
    setActionError('');
    setActionMessage('');
    try {
      const preflight = await eligibilityQuery.refetch();
      if (preflight.isError || !preflight.data?.eligible) {
         throw new Error(preflight.data?.reason || t('rewardPool.fundingEligibilityError'));
      }
      const result = await createOnchainCampaign(celoAmount);
      const record: PendingRewardSync = {
        kind: 'funding',
        data: {
          onchainCampaignId: result.onchainCampaignId,
          contractAddress: REWARD_POOL_CONTRACT_ADDRESS,
          projectWallet: result.address,
          ethFundedRaw: parseEther(celoAmount).toString(),
          txHash: result.hash,
        },
      };
      storePendingSync(record);
      await syncPending(record);
    } catch (error) {
       setActionError(error instanceof Error ? error.message : t('rewardPool.fundingError'));
    } finally {
      setPendingAction(false);
    }
  };

  const swap = async () => {
    if (!configured || !isAdmin || pendingAction || pendingSync) return;
    if (campaign.onchainCampaignId === null || campaign.onchainCampaignId === undefined) return;
    if (!swapQuote || !isRewardSwapQuoteFresh(swapQuote)) {
       setActionError(t('rewardPool.quoteExpiredError'));
      return;
    }
    setActionError('');
    setActionMessage('');
    setPendingAction(true);
    try {
      const result = await finalizeOnchainSwap(campaign.onchainCampaignId, campaign.ethFundedRaw, swapQuote);
      const record: PendingRewardSync = {
        kind: 'swap',
        data: { gdPoolRaw: result.gdPoolRaw, txHash: result.hash },
      };
      storePendingSync(record);
      await syncPending(record);
      setSwapQuote(null);
    } catch (error) {
       setActionError(error instanceof Error ? error.message : t('rewardPool.swapError'));
    } finally {
      setPendingAction(false);
    }
  };

  const requestSwapQuote = async () => {
    if (!configured || !isAdmin || quotePending || pendingAction) return;
    if (campaign.onchainCampaignId === null || campaign.onchainCampaignId === undefined) return;
    setQuotePending(true);
    setSwapQuote(null);
    setActionError('');
    setActionMessage('');
    try {
      const nextQuote = await quoteOnchainSwap(
        campaign.onchainCampaignId,
        campaign.ethFundedRaw,
        slippageBps,
      );
      setSwapQuote(nextQuote);
    } catch (error) {
       setActionError(error instanceof Error ? error.message : t('rewardPool.quoteError'));
    } finally {
      setQuotePending(false);
    }
  };

  const publish = async () => {
    if (!configured || !isAdmin || pendingAction || pendingSync) return;
    if (campaign.onchainCampaignId === null || campaign.onchainCampaignId === undefined || !distributionQuery.data) return;
    setActionError('');
    setActionMessage('');
    setPendingAction(true);
    try {
      const result = await publishOnchainRoot(campaign.onchainCampaignId, distributionQuery.data.merkleRoot as `0x${string}`);
      const record: PendingRewardSync = {
        kind: 'root',
        data: { merkleRoot: distributionQuery.data.merkleRoot, txHash: result.hash },
      };
      storePendingSync(record);
      await syncPending(record);
    } catch (error) {
       setActionError(error instanceof Error ? error.message : t('rewardPool.rootError'));
    } finally {
      setPendingAction(false);
    }
  };

  const refund = async () => {
    if (!configured || !isAdmin || pendingAction || pendingSync || !claimWindowExpired) return;
    if (campaign.onchainCampaignId === null || campaign.onchainCampaignId === undefined) return;
    setPendingAction(true);
    setActionError('');
    setActionMessage('');
    try {
      const result = await withdrawUnclaimedOnchainReward(campaign.onchainCampaignId);
      const record: PendingRewardSync = {
        kind: 'refund',
        data: {
          contractAddress: REWARD_POOL_CONTRACT_ADDRESS,
          txHash: result.hash,
        },
      };
      storePendingSync(record);
      await syncPending(record);
    } catch (error) {
       setActionError(error instanceof Error ? error.message : t('rewardPool.refundError'));
    } finally {
      setPendingAction(false);
    }
  };

  return (
    <div className="mt-6 rounded-sm border border-secondary/50 bg-secondary/10 p-5" data-testid={`panel-reward-pool-${campaign.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
           <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">{t('rewardPool.title')}</p>
           <h4 className="mt-2 text-lg font-semibold tracking-[-.03em]">{t('rewardPool.lifecycle')}</h4>
        </div>
         <span className="rounded-full bg-background px-3 py-1 font-mono text-[10px] uppercase tracking-wider">{t(`rewardPool.status.${campaign.rewardStatus}`)}</span>
      </div>
      {pendingSync && (
        <div className="mt-4 flex flex-col gap-3 rounded-sm border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="status-pending-reward-sync">
           <p className="text-xs leading-5 text-muted-foreground">{t('rewardPool.transactionPending', { kind: t(`rewardPool.syncKind.${pendingSync.kind}`) })}</p>
           <Button onClick={() => void syncPending(pendingSync)} disabled={pendingAction} variant="outline" data-testid="button-retry-reward-sync">{pendingAction ? t('rewardPool.syncing') : t('rewardPool.retrySync')}</Button>
        </div>
      )}
      {!configured && (
        <p className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
           {t('rewardPool.walletDisabled')}
        </p>
      )}
       {!isAdmin && <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('rewardPool.adminOnly')}</p>}
      {configured && isAdmin && campaign.rewardStatus === 'draft' && !eligibilityQuery.data?.eligible && (
        <p className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground" data-testid="status-funding-ineligible">
           {eligibilityQuery.isLoading ? t('rewardPool.checkingEligibility') : eligibilityQuery.isError ? t('rewardPool.eligibilityError') : eligibilityQuery.data?.reason || t('rewardPool.eligibilityDefault')}
        </p>
      )}
      {configured && isAdmin && campaign.rewardStatus === 'draft' && eligibilityQuery.data?.eligible && !pendingSync && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
           <label className="flex-1 text-xs font-medium">{t('rewardPool.fundLabel')}
            <Input value={celoAmount} onChange={(event) => setCeloAmount(event.target.value)} inputMode="decimal" className="mt-2" data-testid="input-reward-celo" />
          </label>
           <Button onClick={() => void fund()} disabled={pendingAction || fundingMutation.isPending || !celoAmount.trim()} data-testid="button-fund-reward-pool">{pendingAction ? t('rewardPool.confirming') : t('rewardPool.fund')} <ArrowUpRight size={15} /></Button>
        </div>
      )}
      {configured && isAdmin && campaign.rewardStatus === 'funded' && !pendingSync && (
        <div className="mt-5">
          <p className="mb-3 rounded-sm border border-border bg-background/60 p-3 text-xs leading-5 text-muted-foreground">
             {t('rewardPool.swapNotice')}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
             <label className="flex-1 text-xs font-medium">{t('rewardPool.slippage')} <span className="text-muted-foreground">({t('rewardPool.bpsHelp')})</span>
              <Input
                value={slippageBps}
                onChange={(event) => {
                  setSlippageBps(event.target.value);
                  setSwapQuote(null);
                }}
                inputMode="numeric"
                 placeholder={t('rewardPool.bpsPlaceholder')}
                className="mt-2"
                data-testid="input-reward-slippage-bps"
              />
            </label>
             <Button onClick={() => void requestSwapQuote()} disabled={pendingAction || quotePending || !slippageBps.trim()} variant="outline" data-testid="button-quote-reward-swap">{quotePending ? t('rewardPool.quoting') : swapQuote ? t('rewardPool.refreshQuote') : t('rewardPool.getQuote')}</Button>
             <Button onClick={() => void swap()} disabled={pendingAction || swapMutation.isPending || !quoteFresh} data-testid="button-finalize-reward-swap">{pendingAction ? t('rewardPool.swapping') : t('rewardPool.confirmSwap')} <ArrowUpRight size={15} /></Button>
          </div>
          {swapQuote && (
            <div className="mt-3 rounded-sm border border-border bg-background/60 p-3 text-xs" data-testid="status-reward-swap-quote">
               <p>{t('rewardPool.liveQuote')} <strong className="font-mono">{formatGdollarAmount(swapQuote.quotedGdRaw, swapQuote.tokenDecimals)} G$</strong></p>
               <p className="mt-1">{t('rewardPool.minimumReceived', { bps: swapQuote.slippageBps })} <strong className="font-mono">{formatGdollarAmount(swapQuote.minimumGdRaw, swapQuote.tokenDecimals)} G$</strong></p>
               <p className="mt-1 text-muted-foreground">{quoteFresh ? t('rewardPool.quoteFresh') : t('rewardPool.quoteExpired')}</p>
            </div>
          )}
        </div>
      )}
      {campaign.rewardStatus === 'swapped' && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
           <div><p className="font-mono text-lg">{campaign.gdPoolRaw} {t('rewardPool.units')}</p><p className="mt-1 text-xs text-muted-foreground">{t('rewardPool.distribution')}</p></div>
           {configured && isAdmin && !pendingSync && <Button onClick={() => void publish()} disabled={pendingAction || rootMutation.isPending || distributionQuery.isLoading || !distributionQuery.data} data-testid="button-publish-reward-root">{pendingAction ? t('rewardPool.publishing') : distributionQuery.isLoading ? t('rewardPool.building') : t('rewardPool.publish')} <ArrowUpRight size={15} /></Button>}
        </div>
      )}
      {(campaign.rewardStatus === 'root-published' || campaign.rewardStatus === 'claiming') && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
           <p className="text-sm text-secondary"><Check size={15} className="mr-2 inline" /> {claimWindowExpired ? t('rewardPool.claimExpired') : campaign.claimDeadline ? t('rewardPool.claimsUntil', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(campaign.claimDeadline)) }) : t('rewardPool.claimOpen')} {t('rewardPool.expiryNote')}</p>
           {configured && isAdmin && claimWindowExpired && !pendingSync && <Button onClick={() => void refund()} disabled={pendingAction || refundMutation.isPending} variant="outline" data-testid="button-refund-unclaimed-gd">{pendingAction ? t('rewardPool.verifying') : t('rewardPool.withdraw')} <ArrowUpRight size={15} /></Button>}
        </div>
      )}
       {campaign.rewardStatus === 'closed' && <p className="mt-5 text-sm text-muted-foreground" data-testid="status-reward-pool-closed">{t('rewardPool.closed')}</p>}
      {actionMessage && <p className="mt-4 text-sm text-secondary" data-testid="status-reward-pool-success">{actionMessage}</p>}
      {actionError && <p className="mt-4 text-sm text-destructive" data-testid="status-reward-pool-error">{actionError}</p>}
    </div>
  );
}

function Projects() {
  const { t } = useTranslation();
  const query = useListCampaigns({ query: { queryKey: getListCampaignsQueryKey(), refetchInterval: 15_000 } });
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get('campaign'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  const detailQuery = useGetCampaign(selectedId ?? 0, { query: { enabled: !!selectedId, queryKey: getGetCampaignQueryKey(selectedId ?? 0), refetchInterval: 15_000 } });
  return (
    <div>
      <PageIntro eyebrow={t('projectUI.eyebrow')} title={<>{t('projectUI.titleFirst')}<br /><span className="text-primary">{t('projectUI.titleAccent')}</span></>} description={t('projectUI.description')} action={<Button asChild variant="outline" data-testid="button-projects-top"><Link href="/launch">{t('projectUI.launch')} <Plus size={15} /></Link></Button>} />
      <div className="grid grid-cols-1 gap-10">
        <section className="min-w-0">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4"><div><p className="font-mono text-[11px] uppercase tracking-[.18em] text-muted-foreground">{t('projectUI.records')}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">{t('projectUI.board')}</h2></div><span className="rounded-full bg-secondary/60 px-3 py-1 font-mono text-[11px]" data-testid="text-campaign-count">{t('projectUI.listed', { count: query.data?.length ?? 0 })}</span></div>
          {query.isLoading && <div className="space-y-3"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-28" /><SkeletonBlock className="h-28" /></div>}
          {query.isError && <QueryError retry={() => void query.refetch()} />}
          {!query.isLoading && !query.isError && (query.data ?? []).length === 0 && <div className="border border-dashed border-border p-12 text-center" data-testid="empty-projects"><Radar className="mx-auto text-primary" size={28} /><h3 className="mt-4 font-semibold">{t('projectUI.emptyTitle')}</h3><p className="mt-2 text-sm text-muted-foreground">{t('projectUI.emptyCopy')}</p></div>}
          <div className="space-y-3">{(!query.isError ? query.data ?? [] : []).map((campaign, index) => <CampaignRow key={campaign.id} campaign={campaign} index={index} onSelect={setSelectedId} />)}</div>
          {selectedId && detailQuery.isError && <QueryError retry={() => void detailQuery.refetch()} />}
          {selectedId && !detailQuery.isError && (
            <div className="mt-7 min-w-0 break-words rounded-sm border border-primary/40 bg-card p-6 [overflow-wrap:anywhere]" data-testid={`panel-campaign-detail-${selectedId}`}>
              {detailQuery.isLoading && <SkeletonBlock className="h-24" />}
               {detailQuery.data && <><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-wider text-primary">{t('projectUI.detail')}</p><h3 className="mt-2 text-xl font-semibold">{detailQuery.data.name}</h3></div><button type="button" onClick={() => setSelectedId(null)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t('common.close')} data-testid="button-close-campaign-detail"><X size={17} /></button></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{detailQuery.data.brief || t('projectUI.noBrief')}</p><div className="mt-5 flex flex-wrap gap-5 border-t border-border pt-4 text-xs text-muted-foreground"><div><CampaignPool campaign={detailQuery.data} /></div><span><strong className="font-mono text-foreground">{number(detailQuery.data.xpAwarded)}</strong> {t('projectUI.xpAwarded')}</span><span><strong className="font-mono text-foreground">{number(detailQuery.data.submissions.length)}</strong> {t('projectUI.submissions')}</span></div>{detailQuery.data.rewardAsset === 'CELO' ? <CeloRewardPoolPanel key={detailQuery.data.id} campaign={detailQuery.data} /> : <RewardPoolPanel campaign={detailQuery.data} />}</>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Creators() {
  const { t } = useTranslation();
  const schema = useMemo(() => createSubmissionSchema(t), [t]);
  const campaigns = useListCampaigns();
  const celoConfig = useGetCeloRewardPoolConfig();
  const client = useQueryClient();
  const mutation = useCreateSubmission();
  const claimMutation = useRecordRewardPoolClaim();
  const [result, setResult] = useState<Submission | null>(null);
  const [walletError, setWalletError] = useState('');
  const [claimSyncMessage, setClaimSyncMessage] = useState('');
  const [claimPending, setClaimPending] = useState(false);
  const form = useForm<z.input<typeof schema>, unknown, SubmissionFormValues>({ resolver: zodResolver(schema), defaultValues: { campaignId: campaigns.data?.[0]?.id ?? 0, handle: '', platform: 'X (Twitter)', link: '', accountAge: 'established', walletAddress: '' } });
  const firstCampaignId = campaigns.data?.[0]?.id ?? 0;
  useEffect(() => {
    if (firstCampaignId && form.getValues('campaignId') === 0) form.setValue('campaignId', firstCampaignId);
  }, [firstCampaignId, form]);
  const walletAddress = form.watch('walletAddress');
  const selectedCampaign = campaigns.data?.find((item) => item.id === Number(form.watch('campaignId')));
  const claimRecoveryKey = selectedCampaign && walletAddress
    ? `ggs:reward-pool-claim-sync:${selectedCampaign.id}:${walletAddress.toLowerCase()}`
    : null;
  const [pendingClaimSync, setPendingClaimSync] = useState<PendingClaimSync | null>(null);
  useEffect(() => {
    setPendingClaimSync(claimRecoveryKey ? readPendingClaimSync(claimRecoveryKey) : null);
    setClaimSyncMessage('');
  }, [claimRecoveryKey]);
  const claimQuery = useGetRewardPoolClaim(selectedCampaign?.id ?? 0, walletAddress || '', {
    query: {
      enabled: Boolean(selectedCampaign && selectedCampaign.rewardAsset !== 'CELO' && walletAddress && /^0x[a-fA-F0-9]{40}$/.test(walletAddress) && (selectedCampaign.rewardStatus === 'root-published' || selectedCampaign.rewardStatus === 'claiming' || selectedCampaign.rewardStatus === 'closed')),
      queryKey: getGetRewardPoolClaimQueryKey(selectedCampaign?.id ?? 0, walletAddress || ''),
    },
  });
  const connectCreatorWallet = async () => {
    setWalletError('');
    try {
      let address: string;
      if (selectedCampaign?.rewardAsset === 'CELO') {
        if (!celoConfig.data) throw new Error(t('celo.notConfigured'));
        address = (await connectCeloAddress(celoConfig.data)).address;
      } else {
        address = (await connectWallet()).address;
      }
      form.setValue('walletAddress', address, { shouldValidate: true });
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('creatorDetail.couldNotConnect'));
    }
  };
  const submit = (values: SubmissionFormValues) => {
    setResult(null);
    mutation.mutate({ campaignId: values.campaignId, data: { handle: values.handle, platform: values.platform, link: values.link, accountAge: values.accountAge, walletAddress: values.walletAddress } }, {
      onSuccess: (submission) => {
        setResult(submission);
        void client.invalidateQueries({ queryKey: getGetCampaignQueryKey(values.campaignId) });
        void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMarketplaceSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetCampaignLeaderboardQueryKey(values.campaignId) });
      },
    });
  };
  const syncClaimRecord = async (
    campaignId: number,
    record: PendingClaimSync,
    recoveryKey: string,
  ) => {
    setClaimPending(true);
    setWalletError('');
    try {
      await claimMutation.mutateAsync({
        campaignId,
        data: {
          walletAddress: record.walletAddress,
          amountRaw: record.amountRaw,
          txHash: record.txHash,
        },
      });
      try {
        window.localStorage.removeItem(recoveryKey);
      } catch {
        // In-memory recovery can complete even when browser storage is blocked.
      }
      setPendingClaimSync(null);
       setClaimSyncMessage(t('claimMessages.recorded'));
      void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetRewardPoolClaimQueryKey(campaignId, record.walletAddress) });
    } catch (error) {
      setWalletError(
        `${error instanceof Error ? error.message : t('claimMessages.marketplaceError')} ${t('claimMessages.syncOnly')}`,
      );
    } finally {
      setClaimPending(false);
    }
  };

  const claim = async () => {
    if (claimPending || !selectedCampaign) return;
    if (pendingClaimSync && claimRecoveryKey) {
      await syncClaimRecord(selectedCampaign.id, pendingClaimSync, claimRecoveryKey);
      return;
    }
    if (selectedCampaign.onchainCampaignId === null || selectedCampaign.onchainCampaignId === undefined || !claimQuery.data) return;
    setWalletError('');
    setClaimSyncMessage('');
    setClaimPending(true);
    try {
      const result = await claimOnchainReward(selectedCampaign.onchainCampaignId, claimQuery.data.amountRaw, claimQuery.data.proof, claimQuery.data.walletAddress);
      const record: PendingClaimSync = {
        walletAddress: result.address,
        amountRaw: claimQuery.data.amountRaw,
        txHash: result.hash,
      };
      const recoveryKey = `ggs:reward-pool-claim-sync:${selectedCampaign.id}:${result.address.toLowerCase()}`;
      setPendingClaimSync(record);
      try {
        window.localStorage.setItem(recoveryKey, JSON.stringify(record));
      } catch {
        // Keep the in-memory recovery action available if browser storage is blocked.
      }
      await syncClaimRecord(selectedCampaign.id, record, recoveryKey);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('claimMessages.failed'));
    } finally {
      if (!pendingClaimSync) setClaimPending(false);
    }
  };
  return (
    <div>
      <PageIntro eyebrow={t('creatorDetail.eyebrow')} title={<>{t('creatorDetail.titleFirst')}<br /><span className="text-primary">{t('creatorDetail.titleAccent')}</span></>} description={t('creator.description')} action={<div className="flex items-center gap-2 rounded-sm border border-secondary bg-secondary/20 px-4 py-3 text-xs font-medium">{t('creator.demo')}</div>} />
      <div className="grid gap-10 lg:grid-cols-[1fr_390px]">
        <section className="rounded-sm border border-border bg-card p-6 sm:p-9">
          <div className="mb-8 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-sm bg-primary text-primary-foreground"><Send size={16} /></span><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('creator.intake')}</p><h2 className="text-xl font-semibold tracking-[-.035em]">{t('creator.score')}</h2></div></div>
          {campaigns.isLoading && <SkeletonBlock className="h-10" />}
          {campaigns.isError && <QueryError retry={() => void campaigns.refetch()} />}
          {!campaigns.isLoading && !campaigns.isError && (campaigns.data ?? []).length === 0 && <div className="rounded-sm border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="empty-creator-campaigns">{t('creator.empty')}</div>}
          {(campaigns.data ?? []).length > 0 && <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-6" data-testid="form-create-submission">
             <FormField control={form.control} name="campaignId" render={({ field }) => <FormItem><FormLabel>{t('creator.campaign')}</FormLabel><FormControl><select {...field} value={field.value} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring" data-testid="select-submission-campaign">{(campaigns.data ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.rewardAsset === 'CELO' ? `CELO Sepolia · ${celoPoolDisplay(campaign).deposit ? t('creatorDetail.confirmedDeposit', { amount: celoPoolDisplay(campaign).deposit }) : t('creatorDetail.targetNotFunded', { amount: celoPoolDisplay(campaign).target })}` : `G$ · ${money(campaign.pool)} ${t('creatorDetail.estimatedPool')}`}</option>)}</select></FormControl><FormMessage /></FormItem>} />
              <div className="grid gap-6 sm:grid-cols-2"><FormField control={form.control} name="handle" render={({ field }) => <FormItem><FormLabel>{t('creator.handle')}</FormLabel><FormControl><Input {...field} placeholder={t('creator.handle')} data-testid="input-submission-handle" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="platform" render={({ field }) => <FormItem><FormLabel>{t('creator.platform')}</FormLabel><FormControl><select {...field} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring" data-testid="select-submission-platform">{Object.values(SubmissionInputPlatform).map((value) => <option key={value} value={value}>{value}</option>)}</select></FormControl><FormMessage /></FormItem>} /></div>
              <FormField control={form.control} name="link" render={({ field }) => <FormItem><FormLabel>{t('creator.postUrl')}</FormLabel><FormControl><div className="relative"><ExternalLink size={15} className="absolute left-3 top-3 text-muted-foreground" /><Input {...field} className="pl-9" placeholder={t('creatorDetail.postUrlPlaceholder')} data-testid="input-submission-link" /></div></FormControl><FormMessage /></FormItem>} />
              <FormField control={form.control} name="accountAge" render={({ field }) => <FormItem><FormLabel>{t('creator.accountAge')}</FormLabel><FormControl><select {...field} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring" data-testid="select-submission-account-age">{Object.values(SubmissionInputAccountAge).map((value) => <option key={value} value={value}>{value === 'under-30-days' ? t('creatorDetail.ageUnder30') : value === '1-6-months' ? t('creatorDetail.ageMonths') : t('creatorDetail.ageEstablished')}</option>)}</select></FormControl><FormMessage /></FormItem>} />
               <FormField control={form.control} name="walletAddress" render={({ field }) => <FormItem><div className="flex items-center justify-between"><FormLabel>{t('creator.wallet')}</FormLabel><button type="button" onClick={() => void connectCreatorWallet()} className="font-mono text-[10px] uppercase tracking-wider text-primary hover:underline">{t('creator.connect')}</button></div><FormControl><Input {...field} placeholder={t('creatorDetail.walletPlaceholder')} className="font-mono text-xs" data-testid="input-submission-wallet" /></FormControl><p className="text-xs text-muted-foreground">{selectedCampaign?.rewardAsset === 'CELO' ? t('creatorDetail.walletCelo') : t('creatorDetail.walletG')}</p><FormMessage /></FormItem>} />
             {walletError && <p className="text-sm text-destructive" data-testid="status-wallet-error">{walletError}</p>}
             <div className="flex items-start gap-3 border-t border-border pt-5 text-xs leading-5 text-muted-foreground"><Check size={15} className="mt-0.5 shrink-0 text-secondary" /> {t('creator.scoreNotice')}</div>
             {mutation.isError && <p className="text-sm text-destructive" data-testid="status-submission-error">{t('creator.scoreError')}</p>}
             <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto" data-testid="button-submit-post">{mutation.isPending ? t('creator.scoring') : t('creator.submit')} <ArrowRight size={15} /></Button>
          </form></Form>}
        </section>
        <aside className="space-y-5">
          <div className="rounded-sm bg-secondary/55 p-6" data-testid="panel-scoring-explanation"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('creatorDetail.readTitle')}</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.045em]">{t('creatorDetail.reachTitle')}</h2><div className="mt-7 space-y-4">{[[t('creator.engagement'), t('creator.engagementInfo')], [t('creator.trust'), t('creator.trustInfo')], [t('creator.consistency'), t('creator.consistencyInfo')]].map(([label, copy], index) => <div key={label} className="border-t border-foreground/15 pt-3"><div className="flex items-center justify-between text-sm font-medium"><span>{label}</span><span className="font-mono text-xs text-primary">0{index + 1}</span></div><p className="mt-1 text-xs text-muted-foreground">{copy}</p></div>)}</div></div>
           {result && <div className="enter-up rounded-sm border border-primary/40 bg-card p-6" data-testid="panel-submission-result"><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary"><Check size={14} /> {t('creatorDetail.recorded')}</p><p className="mt-4 text-4xl font-semibold tracking-[-.06em]">{number(result.xp)} <span className="text-base font-normal text-muted-foreground">XP</span></p><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('creatorDetail.earned', { handle: result.handle, xp: number(result.xp), trust: Math.round(result.trust * 100) })}</p><Link href={`/leaderboard?campaign=${result.campaignId}`} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary" data-testid="link-view-submission-leaderboard">{t('creatorDetail.viewLeaderboard')} <ArrowRight size={14} /></Link></div>}
            {selectedCampaign?.rewardAsset === 'CELO' && <p className="mt-4 text-xs text-muted-foreground">{t('creatorDetail.celoPayout')}</p>}
           {selectedCampaign && selectedCampaign.rewardAsset !== 'CELO' && (selectedCampaign.rewardStatus === 'root-published' || selectedCampaign.rewardStatus === 'claiming') && walletAddress && (
             <div className="rounded-sm border border-secondary/50 bg-secondary/10 p-6" data-testid="panel-creator-claim">
                <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">{t('creatorDetail.claimTitle')}</p>
                 <h3 className="mt-3 text-lg font-semibold">{t('creatorDetail.earnedAllocation')}</h3>
                 <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('creatorDetail.claimWindow')}</p>
                {claimQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">{t('creatorDetail.merkleLoading')}</p>}
                {claimQuery.isError && !pendingClaimSync && <p className="mt-3 text-sm text-muted-foreground">{t('creatorDetail.noClaim')}</p>}
                {pendingClaimSync && <div className="mt-4 rounded-sm border border-primary/40 bg-primary/5 p-4" data-testid="status-pending-claim-sync"><p className="text-xs leading-5 text-muted-foreground">{t('creatorDetail.pendingSync')}</p><Button className="mt-3 w-full" onClick={() => void claim()} disabled={claimPending || claimMutation.isPending} variant="outline" data-testid="button-retry-claim-sync">{claimPending ? t('creatorDetail.syncing') : t('creatorDetail.retrySync')}</Button></div>}
                {claimQuery.data && !pendingClaimSync && <><p className="mt-4 font-mono text-2xl">{claimQuery.data.amountRaw} <span className="text-sm text-muted-foreground">{t('creatorDetail.amountUnits')}</span></p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('creatorDetail.verifiedAmount')}</p>{claimSyncMessage && <p className="mt-3 text-sm text-secondary" data-testid="status-claim-sync">{claimSyncMessage}</p>}<Button className="mt-5 w-full" onClick={() => void claim()} disabled={claimPending || claimMutation.isPending || !isRewardPoolConfigured()} data-testid="button-claim-gdollar">{claimPending ? t('creatorDetail.claiming') : t('creatorDetail.claim')} <ArrowUpRight size={15} /></Button>{!isRewardPoolConfigured() && <p className="mt-3 text-xs text-muted-foreground">{t('creatorDetail.configureContract')}</p>}</>}
             </div>
           )}
           {selectedCampaign && !result && <div className="rounded-sm border border-border p-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('creatorDetail.selectedBrief')}</p><h3 className="mt-3 font-semibold">{selectedCampaign.name}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedCampaign.brief || t('creatorDetail.fallbackBrief')}</p></div>}
        </aside>
      </div>
    </div>
  );
}

function Leaderboard() {
  const { t } = useTranslation();
  const campaigns = useListCampaigns();
  const params = useParams<{ campaignId?: string }>();
  const [selectedId, setSelectedId] = useState<number | null>(params.campaignId ? Number(params.campaignId) : null);
  const campaignId = selectedId ?? campaigns.data?.[0]?.id ?? 0;
  const query = useGetCampaignLeaderboard(campaignId, { query: { enabled: campaignId > 0, queryKey: getGetCampaignLeaderboardQueryKey(campaignId), refetchInterval: 15_000 } });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const selectedCampaign = campaigns.data?.find(campaign => campaign.id === campaignId);
  const totalXp = rows.reduce((sum, row) => sum + row.xp, 0);
  return (
    <div>
       <PageIntro eyebrow={t('leaderboardUI.eyebrow')} title={<>{t('leaderboardUI.titleFirst')}<br /><span className="text-primary">{t('leaderboardUI.titleAccent')}</span></>} description={t('leaderboardUI.description')} />
      <div className="mb-8 flex flex-col gap-4 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
         <div className="flex items-center gap-3"><Trophy size={17} className="text-primary" /><span className="text-sm font-medium">{t('leaderboardUI.viewing')}</span></div>
         <div className="relative w-full sm:w-80"><select aria-label={t('leaderboardUI.viewing')} value={selectedId ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))} className="h-10 w-full appearance-none rounded-sm border border-input bg-card px-3 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring" data-testid="select-leaderboard-campaign"><option value="" disabled>{t('leaderboardUI.select')}</option>{(campaigns.data ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-3 text-muted-foreground" /></div>
      </div>
       {campaigns.isLoading || query.isLoading ? <div className="space-y-2"><SkeletonBlock className="h-16" /><SkeletonBlock className="h-16" /><SkeletonBlock className="h-16" /></div> : query.isError ? <QueryError retry={() => void query.refetch()} /> : rows.length === 0 ? <div className="border border-dashed border-border p-14 text-center" data-testid="empty-leaderboard"><Trophy size={28} className="mx-auto text-primary" /><h3 className="mt-4 font-semibold">{t('leaderboardUI.emptyTitle')}</h3><p className="mt-2 text-sm text-muted-foreground">{t('leaderboardUI.emptyCopy')}</p></div> : (
         <div className="overflow-x-auto rounded-sm border border-border bg-card" data-testid="table-leaderboard"><div className="min-w-[760px]"><div className="grid grid-cols-[70px_1.7fr_100px_100px_110px_120px_100px] gap-4 border-b border-border bg-muted/40 px-5 py-3 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><span>{t('leaderboardUI.rank')}</span><span>{t('leaderboardUI.creator')}</span><span>{t('leaderboardUI.posts')}</span><span>{t('leaderboardUI.xp')}</span><span>{t('leaderboardUI.share')}</span><span>{selectedCampaign?.rewardAsset === 'CELO' ? t('leaderboardUI.estimatedCelo') : t('leaderboardUI.estimatedReward')}</span><span>{t('leaderboardUI.trust')}</span></div>{rows.map((row) => <motion.div layout="position" key={`${campaignId}-${row.handle}-${row.platform}`} transition={{ duration: .25 }}><LeaderboardRowView row={row} celoReward={selectedCampaign?.rewardAsset === 'CELO' ? celoRewardEstimate(selectedCampaign, row.xp, totalXp) : undefined} /></motion.div>)}</div></div>
      )}
       <div className="mt-8 grid gap-4 sm:grid-cols-3"><div className="rounded-sm border border-border bg-card p-5"><BarChart3 size={16} className="text-primary" /><p className="mt-5 text-sm font-medium">{t('leaderboardUI.insight1')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('leaderboardUI.insight1Copy')}</p></div><div className="rounded-sm border border-border bg-card p-5"><Activity size={16} className="text-primary" /><p className="mt-5 text-sm font-medium">{t('leaderboardUI.insight2')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('leaderboardUI.insight2Copy')}</p></div><div className="rounded-sm border border-border bg-card p-5"><FileText size={16} className="text-primary" /><p className="mt-5 text-sm font-medium">{t('leaderboardUI.insight3')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('leaderboardUI.insight3Copy')}</p></div></div>
    </div>
  );
}

function LeaderboardRowView({ row, celoReward }: { row: LeaderboardRow; celoReward?: string }) {
  const percent = (value: number, digits: number) => new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return <div className={`grid grid-cols-[70px_1.7fr_100px_100px_110px_120px_100px] items-center gap-4 border-b border-border px-5 py-5 last:border-0 ${row.rank === 1 ? 'bg-accent/15' : ''}`} data-testid={`row-leaderboard-${row.rank}`}>
    <span className={`font-mono text-lg ${row.rank <= 3 ? 'text-primary' : 'text-muted-foreground'}`}>{String(row.rank).padStart(2, '0')}</span>
    <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-foreground text-xs font-bold text-background">{row.handle.replace('@', '').slice(0, 2).toUpperCase()}</span><div><p className="text-sm font-semibold">{row.handle}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.platform}</p></div></div>
    <span className="font-mono text-sm">{number(row.posts)}</span><span className="font-mono text-sm">{number(row.xp)}</span>
    <span className="font-mono text-sm">{percent(row.share, 1)}</span>
    <span className="font-mono text-sm font-medium text-primary">{celoReward ?? money(row.estimatedReward)}</span>
    <span className="font-mono text-sm">{percent(row.trust, 0)}</span>
  </div>;
}

function Router() {
  const [location] = useLocation();
  const isBrandPage = location === '/' || location === '/about';
  return (
    <RoutedErrorBoundary>
      <PageMetadata />
      {isBrandPage ? (
        <Switch>
          <Route path="/" component={BrandHome} />
          <Route path="/about" component={BrandAbout} />
        </Switch>
      ) : (
        <Shell>
          <Switch>
            <Route path="/overview" component={Overview} />
            <Route path="/launch" component={CampaignLaunch} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/user-portal" component={UserPortal} />
            <Route path="/account" component={AccountPage} />
            <Route path="/projects" component={Projects} />
            <Route path="/admin/payouts" component={CeloAdminDashboard} />
            <Route path="/creators"><AccountRequired><Creators /></AccountRequired></Route>
            <Route path="/leaderboard" component={Leaderboard} />
            <Route path="/daily-g" component={DailyGPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/terms" component={TermsPage} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      )}
    </RoutedErrorBoundary>
  );
}

function PageMetadata() {
  const [location] = useLocation();
  const { t, i18n: localeI18n } = useTranslation();
  useEffect(() => {
    const page = location.split('/')[1];
    const titles: Record<string, string> = { projects: t('pages.projects'), launch: t('forms.launchCampaign'), creators: t('pages.creators'), leaderboard: t('pages.leaderboard'), 'daily-g': t('pages.daily'), privacy: t('pages.privacy'), terms: t('pages.terms'), 'sign-in': t('pages.signIn'), 'sign-up': t('pages.signUp'), 'user-portal': t('pages.workspace'), account: t('pages.account'), overview: t('pages.overview'), about: t('pages.about') };
    const title = `${location === '/' ? t('pages.homeTitle').split(' | ')[0] : titles[page] || t('pages.homeTitle').split(' | ')[0]} | GG’s`;
    const description = page === 'daily-g'
      ? t('pages.dailyDescription')
      : page === 'about'
        ? t('pages.aboutDescription')
        : page === ''
          ? t('pages.description')
          : t('pages.genericDescription');
    document.title = title;
    for (const [attribute, name, content] of [['name', 'description', description], ['property', 'og:title', title], ['property', 'og:description', description]]) {
      let meta = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
      if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attribute, name); document.head.appendChild(meta); }
      meta.content = content;
    }
  }, [location, t, localeI18n.language]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const reduced = useReducedMotion();
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal], .route-enter main > section, .route-enter .market-panel, .route-enter .comparison, .route-enter .audience-card, .route-enter .journey-card, .route-enter .type-card, .route-enter .flow-card, .route-enter .who-card, .route-enter .fee-card');
    nodes.forEach((node, index) => {
      node.classList.add('motion-reveal');
      node.style.transitionDelay = `${Math.min(index % 5, 4) * 60}ms`;
    });
    if (reduced || !('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [location, reduced]);
  return <ErrorBoundary resetKey={location}><motion.div key={location} className="route-enter" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}>{children}</motion.div></ErrorBoundary>;
}

function ScrollChrome() {
  const [scroll, setScroll] = useState(0);
  const [showBackTop, setShowBackTop] = useState(false);
  const [location] = useLocation();
  const { t } = useTranslation();
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScroll(max > 0 ? window.scrollY / max : 0);
      setShowBackTop(window.scrollY >= 600);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [location]);
  const backTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return <>
    <div className="scroll-progress" style={{ transform: `scaleX(${scroll})` }} aria-hidden="true" />
    <button type="button" className={`back-to-top ${showBackTop ? 'is-visible' : ''}`} onClick={backTop} aria-label={t('backTop')} aria-hidden={!showBackTop} tabIndex={showBackTop ? 0 : -1} data-testid="button-back-to-top"><ArrowUp size={17} /><span className="sr-only">{t('backTop')}</span></button>
  </>;
}

function App() {
  return <MotionConfig reducedMotion="user"><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="ggs:theme"><WouterRouter base={basePath}><GGAuthProvider><QueryClientProvider client={queryClient}><AuthCacheInvalidator /><TooltipProvider><ScrollChrome /><Router /><Toaster /></TooltipProvider></QueryClientProvider></GGAuthProvider></WouterRouter></ThemeProvider></MotionConfig>;
}

export default App;