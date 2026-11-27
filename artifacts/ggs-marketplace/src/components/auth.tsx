import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter, useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { Link, Redirect, useLocation } from 'wouter';
import { ArrowRight, Copy, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { safeAuthReturnPath } from '@/lib/campaign-launch-flow';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const appId = import.meta.env.VITE_PRIVY_APP_ID;
if (!appId) throw new Error(i18n.t('authExtra.privyMissing'));

/** Provider-neutral account shape used by marketplace and Daily G$ gates. */
export function useGGAuth() {
  const privy = usePrivy();
  const email = privy.user?.email?.address ?? privy.user?.google?.email;
  return {
    isLoaded: privy.ready,
    isSignedIn: privy.ready && privy.authenticated && Boolean(privy.user),
    user: privy.user ? {
      id: privy.user.id,
      email,
      displayName: privy.user.google?.name || email?.split('@')[0] || i18n.t('authExtra.memberDefault'),
    } : null,
    login: privy.login,
    logout: privy.logout,
  };
}

function PrivyApiBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const session = useRef({ ready, authenticated, getAccessToken });
  session.current = { ready, authenticated, getAccessToken };
  useLayoutEffect(() => {
    setAuthTokenGetter(async () => {
      const current = session.current;
      return current.ready && current.authenticated ? current.getAccessToken() : null;
    });
    return () => setAuthTokenGetter(null);
  }, []);
  return children;
}

export function GGAuthProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <PrivyProvider appId={appId} config={{
      // The Google button below opts into Google only after Privy enables it.
      // Keep the general modal email-only so it never offers a disabled method.
      loginMethods: ['email'],
       appearance: { theme: resolvedTheme === 'dark' ? 'dark' : 'light', accentColor: '#ff8259', logo: `${window.location.origin}${basePath}/logo.svg` },
      // Sign-in must not replace existing payout or GoodDollar browser wallets.
      embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
    }}>
      <PrivyApiBridge>{children}</PrivyApiBridge>
    </PrivyProvider>
  );
}

export function AuthCacheInvalidator() {
  const { user, isLoaded } = useGGAuth();
  const queryClient = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  const id = user?.id ?? null;
  useEffect(() => {
    if (!isLoaded) return;
    if (previous.current !== undefined && previous.current !== id) queryClient.clear();
    previous.current = id;
  }, [id, isLoaded, queryClient]);
  return null;
}

export function AccountControls() {
  const { t } = useTranslation();
  const { user, isLoaded, isSignedIn, logout } = useGGAuth();
  const [, navigate] = useLocation();
  if (!isLoaded) return <span className="text-xs text-muted-foreground">{t('auth.loading')}</span>;
  if (!isSignedIn || !user) return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm"><Link href="/sign-in" data-testid="link-sign-in">{t('authExtra.signInLink')}</Link></Button>
      <Button asChild size="sm"><Link href="/sign-up" data-testid="link-sign-up">{t('authExtra.joinLink')} <ArrowRight size={14} /></Link></Button>
    </div>
  );
  return (
    <div className="flex items-center gap-3">
      <Link href="/user-portal" className="flex items-center gap-2 text-sm font-medium" data-testid="link-account">
        <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs">{user.displayName.slice(0, 2).toUpperCase()}</span>
        <span className="max-w-28 truncate">{user.displayName}</span>
      </Link>
      <button type="button" onClick={() => void logout().then(() => navigate('/'))} aria-label={t('auth.signOut')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-sign-out"><LogOut size={14} /> {t('auth.signOut')}</button>
    </div>
  );
}

export function AccountRequired({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, isLoaded, isSignedIn } = useGGAuth();
  if (!isLoaded) return <div className="rounded-sm border border-border p-8 text-sm text-muted-foreground" role="status">{t('auth.accountLoading')}</div>;
  if (isSignedIn && user) return <Fragment key={user.id}>{children}</Fragment>;
  return (
    <div className="rounded-sm border border-border bg-card p-7 sm:p-9" data-testid="panel-sign-in-required">
      <ShieldCheck size={24} className="text-primary" />
       <h2 className="mt-5 text-2xl font-semibold tracking-tight">{t('auth.accountRequiredTitle')}</h2>
       <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('auth.accountRequiredBody')}</p>
       <div className="mt-6 flex flex-wrap gap-3"><Button asChild><Link href="/sign-in">{t('auth.signInFirst')} <ArrowRight size={15} /></Link></Button><Button asChild variant="outline"><Link href="/sign-up">{t('auth.createAccount')}</Link></Button></div>
       <p className="mt-5 text-xs leading-5 text-muted-foreground">{t('auth.walletNote')}</p>
    </div>
  );
}

function AuthPage({ signup }: { signup: boolean }) {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn, login } = useGGAuth();
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');
  const safeReturnTo = safeAuthReturnPath(returnTo);
  const [error, setError] = useState('');
  const methods = useQuery({
    queryKey: ['privy-login-methods', appId],
    queryFn: async () => {
      const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, { headers: { 'privy-app-id': appId } });
      if (!response.ok) throw new Error('Could not check Privy login settings.');
      const value = await response.json() as { google_oauth?: boolean; email_auth?: boolean };
      if (typeof value.google_oauth !== 'boolean') throw new Error('Invalid Privy login settings.');
      return value;
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  if (isLoaded && isSignedIn) return <Redirect to={safeReturnTo} />;
  const start = (googleOnly: boolean) => {
    setError('');
    try { login(googleOnly ? { loginMethods: ['google'] } : undefined); }
    catch (e) { setError(e instanceof Error ? e.message : t('auth.signInError')); }
  };
  return (
    <div className="mx-auto grid max-w-5xl items-start gap-10 py-5 lg:grid-cols-[1fr_440px] lg:py-12">
      <div className="max-w-md">
         <p className="font-mono text-xs uppercase tracking-widest text-primary">{t('auth.accountEyebrow')}</p>
         <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-[-.05em] sm:text-5xl">{t('auth.accountLead')}<br /><span className="text-primary">{t('auth.accountLeadAccent')}</span></h1>
         <p className="mt-5 text-sm leading-7 text-muted-foreground">{t('auth.accountIntro')}</p>
          <p className="mt-7 text-xs leading-6 text-muted-foreground">{t('authExtra.agreePrefix')}<Link href="/terms" className="underline">{t('legal.draft')} {t('legal.terms')}</Link>{t('authExtra.agreeBetween')}<Link href="/privacy" className="underline">{t('legal.draft')} {t('legal.privacy')}</Link>{t('authExtra.agreeSuffix')}</p>
      </div>
      <div className="rounded-sm border border-border bg-card p-8 text-center shadow-sm" data-testid="panel-privy-sign-in">
        <img src={`${basePath}/logo.svg`} alt={t('authExtra.logoAlt')} className="mx-auto mb-7 h-9" />
         <h2 className="text-2xl font-semibold">{signup ? t('auth.join') : t('auth.welcome')}</h2>
         <p className="mt-3 text-sm text-muted-foreground">{t('auth.privyIntro')}</p>
         <Button className="mt-7 w-full" disabled={!isLoaded || methods.data?.google_oauth !== true || methods.isError} onClick={() => start(true)} data-testid="button-google-sign-in">{t('auth.google')}</Button>
         <Button className="mt-3 w-full" variant="outline" disabled={!isLoaded} onClick={() => start(false)} data-testid="button-privy-sign-in">{t('auth.options')}</Button>
         {methods.data?.google_oauth === false && <p className="mt-4 text-xs text-destructive" data-testid="status-google-disabled">{t('auth.googleDisabled')}</p>}
         {methods.isError && <p className="mt-4 text-xs text-destructive">{t('auth.checkGoogle')} <button className="underline" onClick={() => void methods.refetch()}>{t('auth.retry')}</button></p>}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
         <p className="mt-6 text-xs leading-6 text-muted-foreground">{t('authExtra.walletDisclaimer')}</p>
      </div>
    </div>
  );
}
export const SignInPage = () => <AuthPage signup={false} />;
export const SignUpPage = () => <AuthPage signup />;

export function AccountPage() {
  const { t } = useTranslation();
  const { user, isLoaded, isSignedIn } = useGGAuth();
  const account = useGetCurrentUser({ query: { enabled: isSignedIn, queryKey: [...getGetCurrentUserQueryKey(), user?.id], retry: false } });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  if (!isLoaded) return <p role="status">{t('auth.accountLoading')}</p>;
  if (!isSignedIn || !user) return <Redirect to="/sign-in" />;
  const copyId = async () => {
    if (!account.data?.id) return;
    try { await navigator.clipboard.writeText(account.data.id); setCopied(true); setCopyError(''); }
    catch { setCopyError(t('auth.copyError')); }
  };
  return (
    <div className="mx-auto max-w-5xl py-5">
       <p className="font-mono text-xs uppercase tracking-widest text-primary">{t('auth.accountEyebrow')}</p>
       <h1 className="mt-4 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">{t('auth.accountTitle')}</h1>
      <section className="mt-7 rounded-sm border border-border bg-card p-5" data-testid="panel-privy-identity">
         <h2 className="font-semibold">{t('auth.verifiedId')}</h2>
         <p className="mt-2 text-sm text-muted-foreground">{t('auth.idExplain')}</p>
         {account.isLoading && <p className="mt-3 text-sm">{t('auth.checking')}</p>}
         {account.isError && <div className="mt-3 text-sm text-destructive" role="alert">{t('auth.verifyError')} <button className="underline" onClick={() => void account.refetch()}>{t('auth.retryVerify')}</button></div>}
         {account.data && !account.isError && <><code className="mt-4 block select-all break-all font-mono text-sm" data-testid="text-privy-user-id">{account.data.id}</code><Button size="sm" variant="outline" className="mt-3" onClick={() => void copyId()} data-testid="button-copy-privy-id"><Copy size={14} />{copied ? t('auth.copied') : t('auth.copy')}</Button><p className="mt-3 text-xs text-muted-foreground" data-testid="status-admin-access">{account.data.isAdmin ? t('auth.adminYes') : t('auth.adminNo')}</p></>}
        {copyError && <p className="mt-2 text-xs text-destructive">{copyError}</p>}
      </section>
    </div>
  );
}

export function UserPortal() {
  const { t } = useTranslation();
  const { user, isLoaded, isSignedIn } = useGGAuth();
  if (!isLoaded) return <p role="status">{t('auth.accountLoading')}</p>;
  if (!isSignedIn || !user) return <Redirect to="/sign-in" />;
  return (
    <div className="mx-auto max-w-5xl py-5">
       <p className="font-mono text-xs uppercase tracking-widest text-primary">{t('auth.workspace')}</p>
       <h1 className="mt-4 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">{t('auth.welcomeMember')} {user.displayName}.</h1>
       <p className="mt-5 text-sm leading-7 text-muted-foreground">{t('auth.workspaceIntro')}</p>
      <div className="mt-9 grid gap-5 md:grid-cols-3">
        {[
          ['/launch', t('auth.launch'), t('auth.launchDesc')],
          ['/creators', t('auth.submit'), t('auth.submitDesc')],
          ['/daily-g', t('auth.daily'), t('auth.dailyDesc')],
        ].map(([href, title, copy]) => <Link key={href} href={href} className="rounded-sm border border-border bg-card p-6 transition-colors hover:border-primary" data-testid={`portal-${href.slice(1)}`}><h2 className="text-lg font-semibold">{title}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p><ArrowRight size={18} className="mt-6 text-primary" /></Link>)}
      </div>
       <div className="mt-8 border-t border-border pt-6 text-xs leading-6 text-muted-foreground">{t('auth.workspaceNote')}</div>
    </div>
  );
}
