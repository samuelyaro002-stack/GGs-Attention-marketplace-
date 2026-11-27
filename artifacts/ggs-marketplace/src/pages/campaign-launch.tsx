import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Info, RotateCw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, parseEther } from 'viem';
import { useTranslation } from 'react-i18next';
import { useGGAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import i18n from '@/lib/i18n';
import { formatExactDecimal } from '@/lib/locale-format';
import {
  CAMPAIGN_LAUNCH_CELO_MIN,
  CAMPAIGN_LAUNCH_SIGN_IN_URL,
  clearCampaignLaunchDraft,
  isCampaignQuoteExpired,
  isValidCampaignUsdTarget,
  isValidDirectCampaignCeloTarget,
  loadCampaignLaunchDraft,
  normalizeCampaignQuoteExpiry,
  requestFreshCampaignQuote,
  saveCampaignLaunchDraft,
  shouldAutoRefreshCampaignQuote,
  shouldFetchCampaignUsdQuote,
  type CampaignLaunchDraft,
} from '@/lib/campaign-launch-flow';
import {
  getGetCampaignQuoteQueryKey,
  getListCampaignsQueryKey,
  getGetMarketplaceSummaryQueryKey,
  useCreateCampaign,
  useGetCeloRewardPoolConfig,
  useGetCampaignQuote,
  type CampaignInput,
} from '@workspace/api-client-react';

const celoNetworkMessages = {
  en: {
    mainnetReady: 'Celo Mainnet is live. Funding moves real CELO; check the network and amount before approving.',
    mainnetBlocked: 'Mainnet funding is disabled until its contract is verified and approved. Creating a draft moves no funds.',
    unavailable: 'Funding stays disabled until the selected Celo network can be verified. Creating a draft moves no funds.',
  },
  es: {
    mainnetReady: 'Celo Mainnet está activo. La financiación mueve CELO real; revisa la red y el importe antes de aprobar.',
    mainnetBlocked: 'La financiación de Mainnet está desactivada hasta verificar y aprobar el contrato. Crear un borrador no mueve fondos.',
    unavailable: 'La financiación está desactivada hasta verificar la red Celo seleccionada. Crear un borrador no mueve fondos.',
  },
  fr: {
    mainnetReady: 'Celo Mainnet est actif. Le financement déplace de vrais CELO ; vérifiez le réseau et le montant avant de confirmer.',
    mainnetBlocked: 'Le financement Mainnet est désactivé jusqu’à la vérification et l’approbation du contrat. Créer un brouillon ne déplace aucun fonds.',
    unavailable: 'Le financement reste désactivé jusqu’à la vérification du réseau Celo sélectionné. Créer un brouillon ne déplace aucun fonds.',
  },
  'zh-CN': {
    mainnetReady: 'Celo 主网已启用。注资会转移真实 CELO；确认前请核对网络和金额。',
    mainnetBlocked: '主网合约完成验证和批准前，注资功能保持关闭。创建草稿不会转移资金。',
    unavailable: '所选 Celo 网络通过验证前，注资功能保持关闭。创建草稿不会转移资金。',
  },
} as const;

export default function CampaignLaunch() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { isSignedIn, isLoaded } = useGGAuth();
  const reduced = useReducedMotion();
  const client = useQueryClient();
  const createCampaign = useCreateCampaign();
  const celoConfig = useGetCeloRewardPoolConfig();
  const [draft, setDraft] = useState<CampaignLaunchDraft>(() => loadCampaignLaunchDraft(sessionStorage));
  const [direction, setDirection] = useState(1);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const mainField = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);
  const stepHeading = useRef<HTMLHeadingElement | null>(null);
  const refreshedExpiry = useRef(0);
  const params = useMemo(() => ({ usdAmount: draft.usdAmount }), [draft.usdAmount]);
  const validUsd = isValidCampaignUsdTarget(draft.usdAmount);
  const quoteQuery = useGetCampaignQuote(params, {
    query: { enabled: shouldFetchCampaignUsdQuote(draft.direct, validUsd), queryKey: getGetCampaignQuoteQueryKey(params), retry: false },
  });
  const quote = quoteQuery.data;
  const quoteExpiry = quote ? normalizeCampaignQuoteExpiry(quote.expiresAt) : 0;
  const quoteSeconds = quote ? Math.max(0, Math.ceil((quoteExpiry - now) / 1000)) : 0;
  useEffect(() => {
    if (!shouldAutoRefreshCampaignQuote({
      direct: draft.direct,
      hasQuote: Boolean(quote),
      expiresAt: quoteExpiry,
      now,
      isFetching: quoteQuery.isFetching,
      refreshedExpiry: refreshedExpiry.current,
    })) return;
    refreshedExpiry.current = quoteExpiry;
    void quoteQuery.refetch();
  }, [draft.direct, now, quote, quoteExpiry, quoteQuery.isFetching, quoteQuery.refetch]);
  const amountValue = draft.direct ? draft.celoAmount : quote?.celoAmount ?? '';
  let grossRaw = 0n;
  try { if (amountValue) grossRaw = parseEther(amountValue); } catch { /* Invalid input is handled by validation. */ }
  const feeRaw = grossRaw / 10n;
  const creatorRaw = grossRaw - feeRaw;
  const locale = i18n.resolvedLanguage || 'en';
  const formattedCelo = grossRaw > 0n ? formatExactDecimal(formatEther(grossRaw), locale) : '';
  const feeAmount = formatExactDecimal(formatEther(feeRaw), locale);
  const creatorAmount = formatExactDecimal(formatEther(creatorRaw), locale);
  const cycleWeeks = draft.cycle.startsWith('1') ? 1 : draft.cycle.startsWith('2') ? 2 : 4;
  const cycleLabel = draft.cycle.startsWith('1')
    ? t('projectUI.cycleOne')
    : draft.cycle.startsWith('2')
      ? t('projectUI.cycleTwo')
      : t('projectUI.cycleFour');
  const payoutDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + cycleWeeks * 7);
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
  }, [cycleWeeks, locale]);
  const totalSteps = 5;
  const step = Math.max(0, Math.min(totalSteps - 1, Number(draft.step) || 0));
  const hasAnswers = Boolean(draft.name.trim() || draft.brief.trim() || draft.usdAmount || draft.celoAmount || draft.cycle !== '2 weeks');
  const networkMessages = celoNetworkMessages[(i18n.resolvedLanguage || 'en') as keyof typeof celoNetworkMessages] ?? celoNetworkMessages.en;
  const networkNotice = celoConfig.data?.network === 'mainnet'
    ? celoConfig.data.ready ? networkMessages.mainnetReady : networkMessages.mainnetBlocked
    : celoConfig.data?.network === 'sepolia'
      ? t('launchFlow.testModeNote')
      : networkMessages.unavailable;

  const update = (values: Partial<CampaignLaunchDraft>) => setDraft(current => ({ ...current, ...values }));
  useEffect(() => { saveCampaignLaunchDraft(sessionStorage, draft, step); }, [draft, step]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const keepFocusedControlVisible = () => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement) || !target.closest('[data-testid="page-launch"]')) return;
      window.requestAnimationFrame(() => {
        if (!target.isConnected || document.activeElement !== target) return;
        const rect = target.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const controls = target.closest('[data-testid="page-launch"]')?.querySelector('.launch-controls');
        const controlsHeight = target.closest('.launch-controls') ? 0 : controls?.getBoundingClientRect().height ?? 0;
        const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight) - controlsHeight;
        const margin = 12;
        const offset = rect.bottom > viewportBottom - margin
          ? rect.bottom - viewportBottom + margin
          : rect.top < viewportTop + margin
            ? rect.top - viewportTop - margin
            : 0;
        if (offset) window.scrollTo({ top: window.scrollY + offset, behavior: 'instant' });
      });
    };
    const viewport = window.visualViewport;
    document.addEventListener('focusin', keepFocusedControlVisible);
    window.addEventListener('resize', keepFocusedControlVisible);
    viewport?.addEventListener('resize', keepFocusedControlVisible);
    return () => {
      document.removeEventListener('focusin', keepFocusedControlVisible);
      window.removeEventListener('resize', keepFocusedControlVisible);
      viewport?.removeEventListener('resize', keepFocusedControlVisible);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!hasAnswers || window.confirm(t('launchFlow.exitConfirm'))) navigate('/projects');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasAnswers, navigate, t]);

  const validateStep = () => {
    if (step === 0 && (draft.name.trim().length < 2 || draft.name.trim().length > 80)) return t('launchFlow.nameRequired');
    if (step === 2) {
      if (draft.direct) {
        if (!isValidDirectCampaignCeloTarget(draft.celoAmount)) return t('launchFlow.celoRequired');
      } else if (!validUsd) return t('launchFlow.usdRequired');
      else if (quoteQuery.isError || !quote) return t('launchFlow.quoteUnavailable');
    }
    return '';
  };
  const move = (nextStep: number) => {
    setError('');
    setDirection(nextStep > step ? 1 : -1);
    update({ step: nextStep });
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };
  const next = () => {
    const issue = validateStep();
    if (issue) { setError(issue); return; }
    if (step < totalSteps - 1) move(step + 1);
  };
  const onStepKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLElement && event.target.closest('button')) return;
    if (event.target instanceof HTMLTextAreaElement && event.shiftKey) return;
    event.preventDefault();
    next();
  };
  const selectStep = (target: number) => { if (target < step) move(target); };
  const refreshQuote = async () => {
    const freshQuote = await requestFreshCampaignQuote(() => quoteQuery.refetch());
    if (!freshQuote) setError(t('launchFlow.quoteUnavailable'));
    else setError('');
  };
  const launch = async () => {
    setError('');
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate(CAMPAIGN_LAUNCH_SIGN_IN_URL);
      return;
    }
    let currentQuote = quote;
    if (!draft.direct) {
      if (!validUsd) { setError(t('launchFlow.usdRequired')); move(2); return; }
      if (!currentQuote || isCampaignQuoteExpired(currentQuote.expiresAt, Date.now())) {
        const refreshedQuote = await requestFreshCampaignQuote(() => quoteQuery.refetch());
        if (!refreshedQuote) {
          setError(t('launchFlow.quoteUnavailable'));
          return;
        }
        currentQuote = refreshedQuote;
      }
    }
    const payload: CampaignInput = {
      name: draft.name.trim(),
      brief: draft.brief.trim(),
      pool: 0,
      cycle: draft.cycle,
      rewardAsset: 'CELO',
      ...(draft.direct
        ? { celoTargetAmount: draft.celoAmount.trim() }
        : { usdTargetAmount: draft.usdAmount, quoteToken: currentQuote!.quoteToken }),
    };
    try {
      const campaign = await createCampaign.mutateAsync({ data: payload });
      clearCampaignLaunchDraft(sessionStorage);
      void client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMarketplaceSummaryQueryKey() });
      navigate(`/projects?campaign=${campaign.id}`);
    } catch {
      setError(t('launchFlow.launchFailed'));
    }
  };

  const amountLine = formattedCelo ? `${formattedCelo} CELO` : '';
  const amountReady = draft.direct
    ? isValidDirectCampaignCeloTarget(draft.celoAmount)
    : validUsd && Boolean(quote) && !quoteQuery.isError;
  const stepHint = step === 0 && draft.name.trim().length < 2
    ? t('launchFlow.nameRequired')
    : step === 2 && !draft.direct && draft.usdAmount && !validUsd
      ? t('launchFlow.usdRequired')
      : step === 2 && draft.direct && draft.celoAmount && !amountReady
      ? t('launchFlow.celoRequired')
        : '';

  return (
    <section className="launch-shell mx-auto max-w-2xl" aria-labelledby="launch-heading" data-testid="page-launch">
      <div className="mb-7 flex items-center justify-between gap-3">
        <p className="launch-kicker">{t('launchFlow.eyebrow')}</p>
        <button type="button" className="launch-exit" onClick={() => { if (!hasAnswers || window.confirm(t('launchFlow.exitConfirm'))) navigate('/projects'); }} data-testid="button-exit-launch">{t('launchFlow.exit')}</button>
      </div>
      <div className="mb-10" aria-label={t('launchFlow.progress', { current: step + 1, total: totalSteps })}>
        <div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground" aria-live="polite">{t('launchFlow.progress', { current: step + 1, total: totalSteps })}</span><span className="font-mono text-xs text-primary">0{step + 1} / 05</span></div>
        <div className="launch-progress-track"><span style={{ transform: `scaleX(${(step + 1) / totalSteps})` }} /></div>
        <div className="mt-3 flex gap-2" role="group" aria-label={t('launchFlow.progress')}>
          {Array.from({ length: totalSteps }, (_, index) => <button key={index} type="button" disabled={index >= step} onClick={() => selectStep(index)} aria-label={t('launchFlow.goToStep', { step: index + 1 })} aria-current={index === step ? 'step' : undefined} className={`launch-step-dot ${index <= step ? 'is-done' : ''}`} data-testid={`button-progress-step-${index + 1}`} />)}
        </div>
      </div>
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div key={step} custom={direction} initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 22 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -22 }} transition={{ duration: reduced ? 0.12 : 0.22 }} onAnimationComplete={definition => {
          if (typeof definition === 'object' && 'opacity' in definition && definition.opacity === 1) {
            (mainField.current ?? stepHeading.current)?.focus();
          }
        }} onKeyDown={onStepKey} className="launch-step-content" aria-live="polite">
          <p className="launch-step-label">{t(`launchFlow.step${step + 1}Label`)}</p>
          <h1 ref={stepHeading} id="launch-heading" tabIndex={-1} className="launch-title">{t(`launchFlow.step${step + 1}Title`)}</h1>
          {step === 0 && <div className="mt-8"><label className="launch-label" htmlFor="launch-name">{t('launchFlow.namePrompt')}</label><Input ref={node => { mainField.current = node; }} id="launch-name" autoComplete="off" maxLength={80} value={draft.name} onChange={event => update({ name: event.target.value })} placeholder={t('launchFlow.namePlaceholder')} className="launch-input" data-testid="input-launch-name" /><p className="mt-2 text-xs text-muted-foreground">{t('launchFlow.required')}</p></div>}
          {step === 1 && <div className="mt-8"><label className="launch-label" htmlFor="launch-brief">{t('launchFlow.briefPrompt')}</label><Textarea ref={node => { mainField.current = node; }} id="launch-brief" maxLength={400} rows={6} value={draft.brief} onChange={event => update({ brief: event.target.value })} placeholder={t('launchFlow.briefPlaceholder')} className="launch-input min-h-40 resize-y" data-testid="input-launch-brief" /><p className="mt-2 text-xs text-muted-foreground">{t('launchFlow.optional')} · {draft.brief.length}/400</p></div>}
          {step === 2 && <div className="mt-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="launch-fixed-reward">{t('launchFlow.paidInCelo')}</p><span className="launch-mode-badge">{celoConfig.data?.chainName ?? 'Celo'}</span></div>
            <div><label className="launch-label" htmlFor={draft.direct ? 'launch-celo' : 'launch-usd'}>{t(draft.direct ? 'launchFlow.directLabel' : 'launchFlow.usdLabel')}</label>
              <div className="relative"><span className="launch-currency">{draft.direct ? 'CELO' : '$'}</span><Input ref={node => { mainField.current = node; }} id={draft.direct ? 'launch-celo' : 'launch-usd'} type="text" inputMode="decimal" value={draft.direct ? draft.celoAmount : draft.usdAmount} onChange={event => draft.direct ? update({ celoAmount: event.target.value }) : update({ usdAmount: event.target.value })} placeholder={draft.direct ? t('launchFlow.celoPlaceholder') : t('launchFlow.usdPlaceholder')} className="launch-input pl-16" data-testid="input-launch-pool" /></div>
              {!draft.direct && <div className="mt-3 flex flex-wrap gap-2">{['50', '100', '250', '500'].map(value => <button type="button" key={value} onClick={() => update({ usdAmount: value })} className={`launch-chip ${draft.usdAmount === value ? 'is-selected' : ''}`} data-testid={`button-pool-preset-${value}`}>${value}</button>)}</div>}
            </div>
              {draft.direct ? <p className="launch-info" data-testid="text-direct-celo-note">{t('launchFlow.directNote', { minimum: CAMPAIGN_LAUNCH_CELO_MIN })}</p> : quoteQuery.isLoading ? <div className="launch-quote-skeleton" role="status" aria-label={t('launchFlow.quoteLoading')} /> : quoteQuery.isError && validUsd ? <div className="launch-error-box" role="alert"><p>{t('launchFlow.quoteUnavailable')}</p><button className="launch-text-button" onClick={() => void refreshQuote()} type="button">{t('launchFlow.retryQuote')}</button></div> : quote && <div className="launch-quote" data-testid="text-live-quote">
              <div className="launch-quote-main"><span>{t('launchFlow.about')}</span><strong>{amountLine}</strong></div>
              <div className="launch-quote-splits"><p>{t('launchFlow.platformFee')} <strong>{feeAmount} CELO</strong><small>≈ ${((Number(draft.usdAmount) * 0.1) || 0).toFixed(2)}</small></p><p>{t('launchFlow.creatorReceives')} <strong>{creatorAmount} CELO</strong><small>≈ ${((Number(draft.usdAmount) * 0.9) || 0).toFixed(2)}</small></p></div>
              <p className="launch-rate">{t('launchFlow.rateAge', { rate: quote.rateUsd, age: Math.max(0, Math.floor((now - normalizeCampaignQuoteExpiry(quote.rateUpdatedAt)) / 1000)) })} · {quote.source}</p>
            </div>}
            <p className="launch-test-note">{networkNotice}</p>
            <button type="button" className="launch-text-button" onClick={() => { update({ direct: !draft.direct }); setError(''); }} data-testid="button-toggle-direct-celo">{draft.direct ? t('launchFlow.enterUsd') : t('launchFlow.enterCelo')}</button>
          </div>}
          {step === 3 && <div className="mt-8"><label className="launch-label" htmlFor="launch-cycle">{t('launchFlow.cycleLabel')}</label><select ref={node => { mainField.current = node; }} id="launch-cycle" value={draft.cycle} onChange={event => update({ cycle: event.target.value as CampaignLaunchDraft['cycle'] })} className="launch-input" data-testid="select-launch-cycle"><option value="1 week">{t('projectUI.cycleOne')}</option><option value="2 weeks">{t('projectUI.cycleTwo')}</option><option value="4 weeks">{t('projectUI.cycleFour')}</option></select><p className="mt-4 rounded-sm border border-border bg-muted/50 p-4 text-sm">{t('launchFlow.payoutDate', { date: payoutDate })}</p></div>}
          {step === 4 && <div className="launch-review mt-8" data-testid="panel-launch-review">
            <ReviewRow id="name" label={t('launchFlow.namePrompt')} value={draft.name} onEdit={() => move(0)} edit={t('launchFlow.edit')} />
            <ReviewRow id="brief" label={t('launchFlow.briefPrompt')} value={draft.brief || t('launchFlow.noBrief')} onEdit={() => move(1)} edit={t('launchFlow.edit')} />
            <ReviewRow id="pool" label={t('launchFlow.rewardPool')} value={draft.direct ? `${amountLine} · ${t('launchFlow.directMode')}` : `${amountLine} · about $${draft.usdAmount}`} onEdit={() => move(2)} edit={t('launchFlow.edit')} />
            <div className="launch-review-details">
              <div><p>{t('launchFlow.platformFee')}</p><strong>{feeAmount} CELO</strong><button type="button" onClick={() => move(2)} className="launch-text-button" data-testid="button-edit-platform-fee">{t('launchFlow.edit')}</button></div>
              <div><p>{t('launchFlow.creatorReceives')}</p><strong>{creatorAmount} CELO</strong><button type="button" onClick={() => move(2)} className="launch-text-button" data-testid="button-edit-creator-pool">{t('launchFlow.edit')}</button></div>
            </div>
            <ReviewRow id="cycle" label={t('launchFlow.cycleLabel')} value={cycleLabel} onEdit={() => move(3)} edit={t('launchFlow.edit')} />
            <div className="launch-review-row"><p className="launch-payout-date">{t('launchFlow.payoutDate', { date: payoutDate })}</p><button type="button" onClick={() => move(3)} className="launch-text-button" data-testid="button-edit-payout-date">{t('launchFlow.edit')}</button></div>
            {draft.direct ? <p className="launch-test-note">{t('launchFlow.testModeNote')}</p> : quote && <div className="launch-countdown" data-testid="text-quote-countdown">{quoteSeconds > 0 ? t('launchFlow.quoteCountdown', { seconds: quoteSeconds }) : t('launchFlow.quoteExpired')} {quoteSeconds <= 0 && <button type="button" onClick={() => void refreshQuote()} disabled={quoteQuery.isFetching} className="launch-text-button">{quoteQuery.isFetching ? t('launchFlow.refreshing') : t('launchFlow.refreshQuote')} <RotateCw size={13} /></button>}</div>}
            <p className="launch-disclosure"><Info size={15} />{t('launchFlow.valueDisclosure')}</p>
          </div>}
        </motion.div>
      </AnimatePresence>
      {stepHint && <p className="mt-4 text-xs text-muted-foreground" role="status" data-testid="text-launch-validation-hint">{stepHint}</p>}
      {error && <p className="mt-5 text-sm text-destructive" role="alert" data-testid="status-launch-error">{error}</p>}
      {createCampaign.isPending && <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted" role="status" aria-label={t('launchFlow.launching')}><div className="h-full w-2/3 animate-pulse bg-primary" /></div>}
      <div className="launch-controls">
        {step > 0 ? <Button type="button" variant="outline" onClick={() => move(step - 1)} data-testid="button-launch-previous"><ArrowLeft size={16} /> {t('launchFlow.previous')}</Button> : <Link href="/projects" className="launch-back-link"><ArrowLeft size={16} /> {t('launchFlow.backToCampaigns')}</Link>}
        {step < 4
          ? <Button type="button" onClick={next} disabled={(step === 0 && draft.name.trim().length < 2) || (step === 2 && !amountReady)} data-testid="button-launch-next">{t('launchFlow.next')} <ArrowRight size={16} /></Button>
          : <Button type="button" onClick={() => void launch()} disabled={createCampaign.isPending || (!draft.direct && (!quote || quoteQuery.isError || quoteSeconds <= 0))} data-testid="button-launch-submit">{createCampaign.isPending ? t('launchFlow.launching') : isSignedIn ? t('forms.launch') : t('launchFlow.signInToLaunch')} <ArrowRight size={16} /></Button>}
      </div>
      {step === 4 && !isSignedIn && <p className="mt-4 text-center text-xs text-muted-foreground">{t('launchFlow.signInReason')}</p>}
    </section>
  );
}

function ReviewRow({ id, label, value, edit, onEdit }: { id: string; label: string; value: string; edit: string; onEdit: () => void }) {
  return <div className="launch-review-row"><div className="min-w-0"><p>{label}</p><strong>{value}</strong></div><button type="button" onClick={onEdit} className="launch-text-button" data-testid={`button-edit-review-${id}`}>{edit}</button></div>;
}
