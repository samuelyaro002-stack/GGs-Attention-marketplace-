import { Link } from 'wouter';
import { ArrowLeft, ArrowUpRight, FileText, Shield, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type PolicySection = { title: string; body?: string; bullets?: string[] };

function LegalDocument({ kind, title, intro }: { kind: string; title: string; intro: string }) {
  const { t } = useTranslation();
  const localizedSections = t(
    kind.toLowerCase() === 'privacy' ? 'legalDocuments.privacy' : 'legalDocuments.terms',
    { returnObjects: true },
  ) as PolicySection[];
  return (
    <main className="grain min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-[1040px] px-5 pb-20 pt-7 sm:px-8 lg:px-12 lg:pt-12">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-[-.02em] transition-colors hover:text-primary" data-testid="link-legal-back"><ArrowLeft size={15} /> {t('legal.back')}</Link>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground"><FileText size={14} /> {t('legal.policyDesk')}</span>
        </div>
        <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16">
          <aside className="h-fit border-l-2 border-primary pl-5 lg:sticky lg:top-28">
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">{t(kind.toLowerCase() === 'privacy' ? 'legal.privacy' : 'legal.terms')} / {t('legal.draft')}</p>
            <h1 className="mt-4 text-4xl font-semibold leading-[.98] tracking-[-.065em] sm:text-5xl">{title}</h1>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">{intro}</p>
            <div className="mt-6 flex items-start gap-2 border border-accent/60 bg-accent/15 p-3 text-xs leading-5" data-testid="status-legal-review"><TriangleAlert size={15} className="mt-0.5 shrink-0 text-primary" /><span>{t('legal.legalReview')}</span></div>
            <nav aria-label={t('nav.policy')} className="mt-7 flex gap-2 lg:flex-col">
              <Link href="/privacy" className="border border-border px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary" data-testid="link-privacy-policy">{t('legal.privacyLink')} <ArrowUpRight size={12} className="ml-1 inline" /></Link>
              <Link href="/terms" className="border border-border px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary" data-testid="link-terms-policy">{t('legal.termsLink')} <ArrowUpRight size={12} className="ml-1 inline" /></Link>
            </nav>
          </aside>
          <article className="min-w-0" data-testid={`document-${kind}`}>
            <div className="mb-8 flex items-center gap-3 border-b border-border pb-5">
              <span className="grid size-9 place-items-center border border-secondary/50 bg-secondary/10 text-secondary-foreground"><Shield size={17} /></span>
              <p className="text-xs leading-5 text-muted-foreground">{t('legal.documentNotice')}</p>
            </div>
            {localizedSections.map((section, index) => (
              <section key={section.title} className="border-b border-border py-6 first:pt-0 last:border-0" id={`section-${index + 1}`} data-testid={`section-${kind}-${index + 1}`}>
                <div className="mb-3 flex items-baseline gap-3"><span className="font-mono text-[10px] text-primary">{String(index + 1).padStart(2, '0')}</span><h2 className="text-xl font-semibold tracking-[-.035em]">{section.title}</h2></div>
                {section.body && <p className="text-sm leading-7 text-muted-foreground">{section.body}</p>}
                {section.bullets && <ul className="space-y-3 pl-5 text-sm leading-6 text-muted-foreground marker:text-primary">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              </section>
            ))}
            <div className="mt-8 border border-border bg-card p-5 text-xs leading-5 text-muted-foreground">
              {t('legal.contact')}
            </div>
          </article>
        </div>
      </div>
    </main>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation();
  return <LegalDocument kind="Privacy" title={t('legal.privacy')} intro={t('legal.privacyIntro')} />;
}

export function TermsPage() {
  const { t } = useTranslation();
  return <LegalDocument kind="Terms" title={t('legal.terms')} intro={t('legal.termsIntro')} />;
}