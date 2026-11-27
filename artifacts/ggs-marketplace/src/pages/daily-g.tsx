import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGGAuth } from '@/components/auth';
import { ClaimSDK, CHAIN_DECIMALS, IdentitySDK, chainConfigs } from '@goodsdks/citizen-sdk';
import { createWalletClient, custom, formatUnits, type Address, type TransactionReceipt } from 'viem';
import { celo } from 'viem/chains';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Fingerprint,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { connectWallet, getWalletClient, publicClient } from '@/lib/reward-pool';
import i18n from '@/lib/i18n';
import { SitePreferences } from '@/components/site-preferences';
import { useTranslation } from 'react-i18next';

const CELO_ID = 42220;
const GOODDOLLAR_IDENTITY_HOST = 'goodid.gooddollar.org';
const amountDecimals = CHAIN_DECIMALS[CELO_ID as keyof typeof CHAIN_DECIMALS];
type DailyStatus = 'disconnected' | 'checking' | 'claiming' | 'unverified' | 'eligible' | 'alternate' | 'claimed' | 'error' | 'success';
type PendingWalletAction = {
  id: number;
  kind: 'claim' | 'verify';
  userId: string;
  address: Address;
  generation: number;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function amountLabel(amount: bigint, chainId = CELO_ID) {
  const decimals = CHAIN_DECIMALS[chainId as keyof typeof CHAIN_DECIMALS] ?? amountDecimals;
  const value = Number(formatUnits(amount, decimals));
  return new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { maximumFractionDigits: 4, minimumFractionDigits: 0 }).format(value);
}

function prettyDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC' : '';
}

export default function DailyGPage() {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn, user, login } = useGGAuth();
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletClient, setWalletClient] = useState<ReturnType<typeof createWalletClient> | null>(null);
  const [sdk, setSdk] = useState<{ identity: IdentitySDK; claim: ClaimSDK } | null>(null);
  const [status, setStatus] = useState<DailyStatus>('disconnected');
  const [entitlement, setEntitlement] = useState<bigint>(0n);
  const [alternateEntitlement, setAlternateEntitlement] = useState<{ chainId: number; amount: bigint } | null>(null);
  const [dailyStats, setDailyStats] = useState<{ claimers: bigint; amount: bigint } | null>(null);
  const [nextClaim, setNextClaim] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [claimHash, setClaimHash] = useState<`0x${string}` | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [actionRevision, setActionRevision] = useState(0);
  const refreshVersion = useRef(0);
  const walletActionPending = useRef<PendingWalletAction | null>(null);
  const walletActionSequence = useRef(0);
  const connectPending = useRef<number | null>(null);
  const connectSequence = useRef(0);
  const mounted = useRef(false);
  const walletAddressRef = useRef<Address | null>(null);
  const chainIdRef = useRef<number | null>(chainId);
  const sessionVersion = useRef(0);
  const sessionReady = useRef(false);
  const knownSessionId = useRef<string | null>(null);
  const activeUserId = useRef(user?.id);
  activeUserId.current = user?.id;
  const email = user?.email;
  const sessionState = useRef({ isLoaded, isSignedIn: Boolean(isSignedIn), hasEmail: Boolean(email) });
  sessionState.current = { isLoaded, isSignedIn: Boolean(isSignedIn), hasEmail: Boolean(email) };

  const isCurrentSession = (userId: string, version: number) =>
    mounted.current &&
    sessionVersion.current === version &&
    activeUserId.current === userId &&
    sessionState.current.isLoaded &&
    sessionState.current.isSignedIn &&
    sessionState.current.hasEmail;
  const isCurrentOperation = (generation: number, userId: string, version: number) =>
    isCurrentSession(userId, version) && refreshVersion.current === generation;
  const hasBlockingWalletAction = useCallback(() => {
    const action = walletActionPending.current;
    return Boolean(
      action &&
      action.generation === refreshVersion.current &&
      action.userId === activeUserId.current &&
      action.address.toLowerCase() === walletAddressRef.current?.toLowerCase() &&
      chainIdRef.current === CELO_ID,
    );
  }, []);
  const staleWalletActionPending = Boolean(walletActionPending.current && !hasBlockingWalletAction());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshVersion.current += 1;
      walletActionPending.current = null;
      connectPending.current = null;
    };
  }, []);

  const resetWalletData = useCallback((nextAddress: Address | null, nextChain: number | null) => {
    let nextWalletClient: ReturnType<typeof createWalletClient> | null = null;
    let walletClientError = '';
    if (nextAddress && nextChain === CELO_ID && window.ethereum) {
      try {
        nextWalletClient = createWalletClient({ account: nextAddress, chain: celo, transport: custom(window.ethereum) });
      } catch (reason) {
        walletClientError = reason instanceof Error ? reason.message : t('dailyDetail.walletInit');
      }
    }
    const generation = ++refreshVersion.current;
    walletAddressRef.current = nextAddress;
    chainIdRef.current = nextChain;
    setAddress(nextAddress);
    setChainId(nextChain);
    setWalletClient(nextWalletClient);
    setSdk(null);
    setEntitlement(0n);
    setAlternateEntitlement(null);
    setNextClaim(null);
    setDailyStats(null);
    setClaimHash(null);
    setError(walletClientError);
    setStatus(walletClientError ? 'error' : nextAddress ? 'checking' : 'disconnected');
    setIsVerifying(false);
    return generation;
  }, [t]);

  useEffect(() => {
    const provider = window.ethereum as (typeof window.ethereum & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    });
    if (!provider || !isLoaded) return;
    let active = true;
    let eventVersion = 0;
    const generationAtStart = refreshVersion.current;
    const sessionAtStart = activeUserId.current;
    const sessionGenerationAtStart = sessionVersion.current;
    void Promise.all([
      provider.request({ method: 'eth_accounts' }),
      provider.request({ method: 'eth_chainId' }),
    ]).then(([accounts, chain]) => {
      if (
        !active ||
        !mounted.current ||
        generationAtStart !== refreshVersion.current ||
        sessionGenerationAtStart !== sessionVersion.current ||
        sessionAtStart !== activeUserId.current ||
        eventVersion !== 0
      ) return;
      const canRestoreWallet = Boolean(sessionAtStart && email);
      const walletAddress = canRestoreWallet && Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] as Address : null;
      resetWalletData(walletAddress, typeof chain === 'string' ? Number.parseInt(chain, 16) : null);
    }).catch((reason: unknown) => {
      if (
        active &&
        mounted.current &&
        generationAtStart === refreshVersion.current &&
        sessionGenerationAtStart === sessionVersion.current &&
        sessionAtStart === activeUserId.current &&
        eventVersion === 0 &&
        sessionAtStart &&
        email
      ) {
        setError(reason instanceof Error ? reason.message : t('dailyDetail.walletRead'));
        setStatus('error');
      }
    });

    const onAccountsChanged = (accounts: unknown) => {
      const currentEvent = ++eventVersion;
      const authenticated = Boolean(activeUserId.current && email && sessionState.current.isLoaded && sessionState.current.isSignedIn);
      const selected = authenticated && Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] as Address : null;
      const generation = resetWalletData(selected, null);
      const eventSessionId = activeUserId.current;
      const eventSessionVersion = sessionVersion.current;
      void provider.request({ method: 'eth_chainId' }).then((chain: unknown) => {
        if (
          active &&
          mounted.current &&
          currentEvent === eventVersion &&
          generation === refreshVersion.current &&
          eventSessionVersion === sessionVersion.current &&
          eventSessionId === activeUserId.current
        ) {
          resetWalletData(selected, typeof chain === 'string' ? Number.parseInt(chain, 16) : null);
        }
      }).catch((reason: unknown) => {
        if (
          active &&
          mounted.current &&
          currentEvent === eventVersion &&
          generation === refreshVersion.current &&
          eventSessionVersion === sessionVersion.current &&
          eventSessionId === activeUserId.current
        ) {
          setError(reason instanceof Error ? reason.message : t('dailyDetail.networkRead'));
          setStatus('error');
        }
      });
    };
    const onChainChanged = (chain: unknown) => {
      eventVersion += 1;
      const authenticated = Boolean(activeUserId.current && email && sessionState.current.isLoaded && sessionState.current.isSignedIn);
      resetWalletData(
        authenticated ? walletAddressRef.current : null,
        typeof chain === 'string' ? Number.parseInt(chain, 16) : null,
      );
    };
    provider.on?.('accountsChanged', onAccountsChanged);
    provider.on?.('chainChanged', onChainChanged);
    return () => {
      active = false;
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
    };
  }, [isLoaded, isSignedIn, email, resetWalletData]);

  useEffect(() => {
    if (!isLoaded) return;
    const nextSessionId = isSignedIn && user?.id ? `${user.id}:${email ?? ''}` : null;
    if (!sessionReady.current) {
      sessionReady.current = true;
      knownSessionId.current = nextSessionId;
      return;
    }
    if (knownSessionId.current !== nextSessionId) {
      knownSessionId.current = nextSessionId;
      sessionVersion.current += 1;
      resetWalletData(null, chainId);
      connectPending.current = null;
      setIsConnecting(false);
    }
  }, [isLoaded, isSignedIn, user?.id, email, chainId, resetWalletData]);

  useEffect(() => {
    if (!walletClient || !address || chainId !== CELO_ID || !isSignedIn || !email) {
      setSdk(null);
      setEntitlement(0n);
      setAlternateEntitlement(null);
      setDailyStats(null);
      setNextClaim(null);
      setClaimHash(null);
      setStatus(address && chainId === CELO_ID && isSignedIn && email ? 'checking' : 'disconnected');
      return;
    }
    let current = true;
    const generation = refreshVersion.current;
    const ownerId = user.id;
    const ownerSessionVersion = sessionVersion.current;
    const isCurrent = () => current && isCurrentOperation(generation, ownerId, ownerSessionVersion);
    const sdkPublicClient = publicClient as Parameters<typeof IdentitySDK.init>[0]['publicClient'];
    const sdkWalletClient = walletClient as Parameters<typeof IdentitySDK.init>[0]['walletClient'];
    void IdentitySDK.init({ publicClient: sdkPublicClient, walletClient: sdkWalletClient, env: 'production' }).then(async (identity) => {
      if (!isCurrent()) return;
      const claim = await ClaimSDK.init({ publicClient: sdkPublicClient, walletClient: sdkWalletClient, identitySDK: identity, env: 'production' });
      if (isCurrent()) setSdk({ identity, claim });
    }).catch((reason: unknown) => {
      if (isCurrent()) {
        setError(reason instanceof Error ? reason.message : t('dailyDetail.sdkInit'));
        setStatus('error');
      }
    });
    return () => { current = false; };
  }, [walletClient, address, chainId, isSignedIn, email, user?.id]);

  const refreshStatus = useCallback(async () => {
    if (!address || !sdk || chainId !== CELO_ID || !isSignedIn || !email || !user?.id || hasBlockingWalletAction()) return;
    const requestVersion = ++refreshVersion.current;
    const ownerId = user.id;
    const ownerSessionVersion = sessionVersion.current;
    setError('');
    setStatus('checking');
    const isCurrent = () => isCurrentOperation(requestVersion, ownerId, ownerSessionVersion);
    try {
      const [identity, stats] = await Promise.all([
        sdk.identity.getWhitelistedRoot(address),
        sdk.claim.getDailyStats(),
      ]);
      if (!isCurrent() || walletAddressRef.current?.toLowerCase() !== address.toLowerCase()) return;
      setDailyStats(stats);
      if (!identity.isWhitelisted) {
        setEntitlement(0n);
        setAlternateEntitlement(null);
        setNextClaim(null);
        setStatus('unverified');
        return;
      }
      const result = await sdk.claim.checkEntitlement();
      if (!isCurrent()) return;
      setEntitlement(result.amount);
      setAlternateEntitlement(result.altClaimAvailable && result.altChainId !== null && result.altAmount !== null
        ? { chainId: result.altChainId, amount: result.altAmount }
        : null);
      if (result.amount > 0n) {
        setNextClaim(null);
        setStatus('eligible');
      } else if (result.altClaimAvailable && result.altChainId !== null && result.altAmount !== null) {
        setNextClaim(null);
        setStatus('alternate');
      } else {
        const next = await sdk.claim.nextClaimTime();
        if (!isCurrent()) return;
        setNextClaim(next);
        setStatus('claimed');
      }
    } catch (reason) {
      if (!isCurrent()) return;
      setError(reason instanceof Error ? reason.message : t('dailyDetail.claimRead'));
      setStatus('error');
    }
  }, [address, chainId, isSignedIn, email, sdk, user?.id, hasBlockingWalletAction]);

  const startSignIn = async () => {
    try {
      login();
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : t('dailyDetail.signInError'));
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !email) return;
    if (address && chainId === CELO_ID && sdk) void refreshStatus();
    else if (address && chainId !== CELO_ID) setStatus('disconnected');
  }, [isLoaded, isSignedIn, email, address, chainId, sdk, refreshStatus]);

  const connect = async () => {
    if (!isSignedIn || !user?.email) {
      await startSignIn();
      return;
    }
    if (connectPending.current !== null) return;
    const connectToken = ++connectSequence.current;
    connectPending.current = connectToken;
    setIsConnecting(true);
    setError('');
    const connectingUser = user.id;
    const connectingSessionVersion = sessionVersion.current;
    const operationGeneration = resetWalletData(null, chainId);
    const isCurrent = () => isCurrentSession(connectingUser, connectingSessionVersion);
    let snapshotGeneration: number | null = null;
    try {
      const { address: selected } = await connectWallet();
      if (!isCurrent()) return;
      getWalletClient();
      const client = createWalletClient({
        account: selected,
        chain: celo,
        transport: custom(window.ethereum!),
      });
      // Start a fresh generation only after the expected account/chain prompts.
      // This supersedes their slower event reads while events after this point
      // invalidate this snapshot in the normal way.
      snapshotGeneration = ++refreshVersion.current;
      const [accounts, chain] = await Promise.all([
        window.ethereum!.request({ method: 'eth_accounts' }),
        window.ethereum!.request({ method: 'eth_chainId' }),
      ]);
      if (!isCurrent() || snapshotGeneration !== refreshVersion.current) return;
      const providerAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
      if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain)) {
        throw new Error(t('dailyDetail.invalidChain'));
      }
      const activeChain = Number.parseInt(chain, 16);
      if (providerAddress.toLowerCase() !== selected.toLowerCase()) {
        const currentAddress = walletAddressRef.current?.toLowerCase();
        if (
          isCurrent() &&
          snapshotGeneration === refreshVersion.current &&
          (!currentAddress || currentAddress === selected.toLowerCase())
        ) {
          setError(t('dailyDetail.walletChanged'));
          setStatus('error');
        }
        return;
      }
      if (!isCurrent() || snapshotGeneration !== refreshVersion.current) return;
      if (walletAddressRef.current?.toLowerCase() !== selected.toLowerCase() || chainIdRef.current !== activeChain) {
        resetWalletData(selected, activeChain);
      }
    } catch (reason) {
      const errorGeneration = snapshotGeneration ?? operationGeneration;
      if (isCurrent() && errorGeneration === refreshVersion.current) {
        setError(reason instanceof Error ? reason.message : t('dailyDetail.connectionFailed'));
        setStatus('error');
      }
    } finally {
      if (connectPending.current === connectToken) {
        connectPending.current = null;
        if (mounted.current) setIsConnecting(false);
      }
    }
  };

  const verify = async () => {
    if (!sdk || !address || chainId !== CELO_ID || walletActionPending.current !== null || !user?.id) return;
    const actionId = ++walletActionSequence.current;
    const requestVersion = ++refreshVersion.current;
    const ownerId = user.id;
    const ownerSessionVersion = sessionVersion.current;
    walletActionPending.current = { id: actionId, kind: 'verify', userId: ownerId, address, generation: requestVersion };
    setActionRevision((revision) => revision + 1);
    const isCurrent = () => isCurrentOperation(requestVersion, ownerId, ownerSessionVersion);
    setIsVerifying(true);
    setError('');
    try {
      const link = await sdk.identity.generateFVLink(false, window.location.href, CELO_ID);
      if (!isCurrent()) return;
      const url = new URL(link);
      if (url.protocol !== 'https:' || url.hostname !== GOODDOLLAR_IDENTITY_HOST) {
        throw new Error(t('dailyDetail.verificationAddress'));
      }
      window.location.assign(url.toString());
    } catch (reason) {
      if (!isCurrent()) return;
      setError(reason instanceof Error ? reason.message : t('dailyDetail.verificationFailed'));
      setStatus('error');
    } finally {
      if (walletActionPending.current?.id === actionId) {
        walletActionPending.current = null;
        if (mounted.current) {
          setIsVerifying(false);
          setActionRevision((revision) => revision + 1);
        }
      }
    }
  };

  const claim = async () => {
    if (!sdk || !address || status !== 'eligible' || walletActionPending.current !== null || !user?.id) return;
    const actionId = ++walletActionSequence.current;
    const requestVersion = ++refreshVersion.current;
    const ownerId = user.id;
    const ownerSessionVersion = sessionVersion.current;
    const claimAddress = address.toLowerCase();
    walletActionPending.current = { id: actionId, kind: 'claim', userId: ownerId, address, generation: requestVersion };
    setActionRevision((revision) => revision + 1);
    const isCurrent = () =>
      isCurrentOperation(requestVersion, ownerId, ownerSessionVersion) &&
      walletAddressRef.current?.toLowerCase() === claimAddress;
    setStatus('claiming');
    setError('');
    setClaimHash(null);
    try {
      const receipt = await sdk.claim.claim() as TransactionReceipt;
      if (!isCurrent()) return;
      if (receipt.status !== 'success') throw new Error(t('dailyDetail.reverted'));
      setClaimHash(receipt.transactionHash);
      setStatus('success');
      if (walletActionPending.current?.id === actionId) {
        walletActionPending.current = null;
        if (mounted.current) setActionRevision((revision) => revision + 1);
      }
      try {
        const next = await sdk.claim.nextClaimTime();
        if (isCurrent()) setNextClaim(next);
      } catch {
        // Keep a confirmed receipt successful even if this follow-up read is unavailable.
      }
    } catch (reason) {
      if (!isCurrent()) return;
      setError(reason instanceof Error ? reason.message : t('dailyDetail.claimFailed'));
      setStatus('error');
    } finally {
      if (walletActionPending.current?.id === actionId) {
        walletActionPending.current = null;
        if (mounted.current) setActionRevision((revision) => revision + 1);
      }
    }
  };

  const explorerUrl = useMemo(() => chainConfigs[CELO_ID as keyof typeof chainConfigs]?.explorer.tx(claimHash || ''), [claimHash]);
  const isWrongNetwork = Boolean(address && chainId !== null && chainId !== CELO_ID);

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-8 sm:px-8 lg:px-12 lg:pt-14">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center border border-primary/50 bg-primary/10 text-primary"><span className="font-mono text-sm font-bold">G$</span></span>
            <div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('daily.label')}</p><p className="text-sm font-semibold tracking-[-.02em]">GoodDollar UBI</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-3"><SitePreferences compact /><div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
            <span className="live-dot size-2 rounded-full bg-secondary" /> {t('daily.network')} · 42220
          </div></div>
        </div>

        <section className="grid-paper relative overflow-hidden rounded-sm border border-border bg-card px-6 py-9 sm:px-10 sm:py-12 lg:grid lg:grid-cols-[1fr_340px] lg:gap-12 lg:px-14 lg:py-14">
          <div className="absolute -right-20 -top-24 size-72 rounded-full border-[36px] border-primary/10" aria-hidden="true" />
          <div className="relative">
            <p className="mb-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.2em] text-primary"><span className="h-px w-7 bg-primary" /> {t('daily.claimStatus')}</p>
            <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[.94] tracking-[-.07em] sm:text-6xl lg:text-[5.4rem]">{t('daily.title')}<br /><span className="text-primary">{t('daily.titleAccent')}</span></h1>
            <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground">{t('daily.intro')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {!isLoaded ? (
                <div className="h-11 w-52 animate-pulse rounded-sm bg-muted" data-testid="loading-privy-session" />
              ) : !isSignedIn || !email ? (
                 <Button onClick={() => void startSignIn()} data-testid="button-sign-in-daily">{t('daily.signIn')} <ArrowRight size={15} /></Button>
              ) : !address ? (
                <Button onClick={() => void connect()} disabled={isConnecting} data-testid="button-connect-daily-wallet">
                   {isConnecting ? <LoaderCircle className="animate-spin" size={15} /> : <Wallet size={15} />} {isConnecting ? t('daily.connecting') : t('daily.connect')}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 border border-border bg-background px-3 py-2 font-mono text-xs" data-testid="text-daily-wallet"><Wallet size={14} className="text-primary" /> {shortAddress(address)}</span>
                  <Button variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={!sdk || status === 'checking' || status === 'claiming' || isVerifying || hasBlockingWalletAction()} data-testid="button-refresh-daily-status"><RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : ''} /> {t('daily.refresh')}</Button>
                    {isWrongNetwork && <Button size="sm" onClick={() => void connect()} disabled={isConnecting} data-testid="button-switch-daily-network">{t('daily.switchNetwork')}</Button>}
                </div>
              )}
            </div>
            {isSignedIn && email && <p className="mt-3 text-xs text-muted-foreground" data-testid="text-daily-account-email">{t('dailyDetail.signedIn', { email })}</p>}
            {(!isSignedIn || !email) && isLoaded && <p className="mt-3 text-xs text-muted-foreground">{t('daily.signInEmail')}</p>}
            {isWrongNetwork && <div className="mt-4 flex max-w-xl items-start gap-2 border border-accent/60 bg-accent/15 p-3 text-sm" role="status" data-testid="status-wrong-network"><CircleAlert size={16} className="mt-0.5 shrink-0 text-primary" /><span>{t('daily.wrongNetwork', { chain: chainId })}</span></div>}
            {error && <div className="mt-4 flex max-w-xl items-start gap-2 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="status-daily-error"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {staleWalletActionPending && <div className="mt-4 flex max-w-xl items-start gap-2 border border-primary/40 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground" role="status" data-testid="status-prior-wallet-action" data-action-revision={actionRevision}><Clock3 size={15} className="mt-0.5 shrink-0 text-primary" /><span>{t('daily.priorAction')}</span></div>}
          </div>

          <aside className="relative mt-10 border-t border-border pt-6 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('daily.claimStatus')}</p>
            <div className="mt-4 flex items-center gap-3">
              <span className={`grid size-10 place-items-center border ${status === 'eligible' || status === 'success' ? 'border-secondary/70 bg-secondary/15 text-secondary-foreground' : 'border-border bg-background text-muted-foreground'}`}>
                {status === 'checking' || status === 'claiming' ? <LoaderCircle size={18} className="animate-spin" /> : status === 'eligible' || status === 'success' ? <Check size={18} /> : status === 'claimed' ? <Clock3 size={18} /> : <Fingerprint size={18} />}
              </span>
              <div>
                <p className="font-semibold tracking-[-.02em]" data-testid="text-daily-status">
                  {t(`daily.${status === 'claiming' ? 'submitted' : status === 'checking' ? 'checking' : status}`)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('daily.identity')}</p>
              </div>
            </div>

            {status === 'checking' && <div className="mt-7 space-y-3" aria-label={t('dailyDetail.loadingStatus')}><div className="h-8 w-2/3 animate-pulse bg-muted" /><div className="h-4 w-full animate-pulse bg-muted" /><div className="h-11 w-full animate-pulse bg-muted" /></div>}
            {status === 'claiming' && <div className="mt-7 flex items-start gap-3 border border-primary/40 bg-primary/5 p-5" role="status" data-testid="panel-daily-pending"><LoaderCircle size={17} className="mt-0.5 animate-spin text-primary" /><div><p className="text-sm font-semibold">{t('daily.waitReceipt')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('daily.keepOpen')}</p></div></div>}
            {status === 'eligible' && (
              <div className="mt-7 border border-secondary/60 bg-secondary/10 p-5" data-testid="panel-daily-entitlement">
                <p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{t('daily.available')}</p>
                <p className="mt-2 font-mono text-4xl font-medium tracking-[-.06em]" data-testid="text-daily-entitlement">{amountLabel(entitlement)} <span className="text-xl text-primary">G$</span></p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('daily.amountSource')}</p>
                <Button onClick={() => void claim()} disabled={walletActionPending.current !== null} className="mt-5 w-full" data-testid="button-claim-daily">{t('daily.claim')} <ArrowUpRight size={15} /></Button>
              </div>
            )}
            {status === 'unverified' && (
              <div className="mt-7 border border-primary/40 bg-primary/5 p-5" data-testid="panel-daily-verification">
                <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-primary" /> {t('dailyDetail.verifyTitle')}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.verifyBody')}</p>
                <Button onClick={() => void verify()} disabled={isVerifying || walletActionPending.current !== null} variant="outline" className="mt-5 w-full" data-testid="button-verify-gooddollar">
                  {isVerifying ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUpRight size={15} />} {isVerifying ? t('dailyDetail.opening') : t('dailyDetail.verifyTitle')}
                </Button>
              </div>
            )}
            {status === 'alternate' && alternateEntitlement && (
              <div className="mt-7 border border-accent/60 bg-accent/15 p-5" data-testid="panel-daily-alternate-network">
                <p className="font-semibold">{t('dailyDetail.alternateTitle')}</p>
                <p className="mt-2 font-mono text-2xl">{amountLabel(alternateEntitlement.amount, alternateEntitlement.chainId)} G$</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.alternateBody', { chain: alternateEntitlement.chainId })}</p>
              </div>
            )}
            {status === 'claimed' && (
              <div className="mt-7 border border-border bg-background p-5" data-testid="panel-daily-claimed">
                <p className="font-semibold">{t('dailyDetail.claimedCycle')}</p>
                {nextClaim && nextClaim.getTime() > 0 && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 size={14} /> {t('dailyDetail.nextCheck', { date: prettyDate(nextClaim) })}</p>}
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('dailyDetail.eligibility')}</p>
              </div>
            )}
            {status === 'success' && (
              <div className="mt-7 border border-secondary/60 bg-secondary/10 p-5" data-testid="panel-daily-success">
                <p className="flex items-center gap-2 font-semibold"><Check size={16} /> {t('dailyDetail.confirmed')}</p>
                {claimHash && explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4" data-testid="link-daily-transaction">{t('dailyDetail.explorer')} <ExternalLink size={13} /></a>}
                {nextClaim && nextClaim.getTime() > 0 && <p className="mt-3 text-xs text-muted-foreground">{t('dailyDetail.nextClaim', { date: prettyDate(nextClaim) })}</p>}
              </div>
            )}
            {(status === 'error' || status === 'disconnected') && (
              <div className="mt-7 border border-border bg-background p-5" data-testid="panel-daily-prompt">
                <p className="text-sm leading-6 text-muted-foreground">
                  {status === 'error' ? t('dailyDetail.noState') : !isSignedIn ? t('dailyDetail.signConnect') : address && isWrongNetwork ? t('dailyDetail.switchCelo') : address ? t('dailyDetail.prepare') : t('dailyDetail.connectRead')}
                </p>
                {status === 'error' && <Button variant="outline" size="sm" className="mt-4" onClick={() => sdk ? void refreshStatus() : void connect()} data-testid="button-retry-daily"><RefreshCw size={14} /> {sdk ? t('dailyDetail.retryStatus') : t('dailyDetail.reconnect')}</Button>}
              </div>
            )}
          </aside>
        </section>

        <section className="mt-12 grid gap-10 border-b border-border pb-12 md:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">{t('dailyDetail.separateEyebrow')}</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight tracking-[-.05em] sm:text-4xl">{t('dailyDetail.separateTitle')}</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{t('dailyDetail.separateBody')}</p>
          </div>
          <div className="grid gap-5 border-l-2 border-primary/60 pl-5 sm:grid-cols-2">
             <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Fingerprint size={14} className="text-primary" /> {t('dailyDetail.eligibilityTitle')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.eligibilityBody')}</p></div>
             <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Globe2 size={14} className="text-primary" /> {t('dailyDetail.amountTitle')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.amountBody')}</p></div>
             <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><LockKeyhole size={14} className="text-primary" /> {t('dailyDetail.hostedTitle')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.hostedBody')}</p></div>
             <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><ArrowDownRight size={14} className="text-primary" /> {t('dailyDetail.progressTitle')}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('dailyDetail.progressBody')}</p></div>
          </div>
        </section>

        <section className="mt-8 grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{t('dailyDetail.readout')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('dailyDetail.currentActivity')}</p>
          </div>
          <div className="flex gap-8">
            <div><p className="font-mono text-xl" data-testid="text-daily-claimers">{dailyStats ? new Intl.NumberFormat(i18n.resolvedLanguage || 'en').format(Number(dailyStats.claimers)) : '…'}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t('dailyDetail.claimersToday')}</p></div>
            <div><p className="font-mono text-xl" data-testid="text-daily-distributed">{dailyStats ? `${amountLabel(dailyStats.amount)} G$` : '…'}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t('dailyDetail.distributedToday')}</p></div>
          </div>
        </section>
         <p className="mt-8 flex items-start gap-2 border-t border-border pt-5 text-xs leading-5 text-muted-foreground"><Clock3 size={14} className="mt-0.5 shrink-0 text-primary" />{t('dailyDetail.availabilityNote')}</p>
      </div>
    </div>
  );
}