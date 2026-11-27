import { useEffect, useState } from 'react';
import { ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useGGAuth } from '@/components/auth';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SitePreferences } from '@/components/site-preferences';
import './brand-site.css';
import { EcosystemMarquee } from '@/components/ecosystem-marquee';

const logoSrc = `${import.meta.env.BASE_URL}brand/logo.svg`;

type FaqItem = { question: string; answer: string };

function Header() {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [location] = useLocation();
  const { isSignedIn } = useGGAuth();
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`site-header ${compact ? 'is-compact' : ''}`}>
      <div className="container header-inner">
        <Link href="/" aria-label={t('brand.homeLink')}>
          <img className="brand-logo brand-logo-light" src={logoSrc} width="216" height="40" alt={t('brand.logoAlt')} />
          <img className="brand-logo brand-logo-dark" src={`${import.meta.env.BASE_URL}brand/logo-dark.svg`} width="216" height="40" alt={t('brand.logoAlt')} />
        </Link>
        <nav className="nav-links" aria-label={t('nav.main')}>
          <Link href="/about">{t('nav.about')}</Link>
          <Link href="/overview">{t('nav.overview')}</Link>
          <Link href="/projects">{t('nav.projects')}</Link>
          <Link href={isSignedIn ? '/user-portal' : '/sign-in'}>
            {isSignedIn ? t('nav.workspace') : t('nav.signIn')}
          </Link>
        </nav>
        <div className="nav-actions">
          <SitePreferences compact />
          <Link className="button button-primary" href="/launch">{t('nav.launch')} <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        <button
          className="menu-toggle"
          type="button"
          aria-label={open ? t('nav.menuClose') : t('nav.menuOpen')}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen((value) => !value)}
          data-testid="button-mobile-menu"
        >
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && <motion.button key="brand-backdrop" type="button" className="mobile-menu-backdrop brand-menu-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} aria-label={t('nav.menuClose')} data-testid="button-brand-menu-backdrop" />}
        {open && <motion.nav key="brand-mobile-navigation" className="mobile-menu" id="mobile-navigation" aria-label={t('nav.mobile')} initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -6 }} transition={{ duration: reduced ? 0 : .18 }}>
          <Link href="/about">{t('nav.about')}</Link>
          <Link href="/overview">{t('nav.overview')}</Link>
          <Link href="/projects">{t('nav.projects')}</Link>
          <Link href={isSignedIn ? '/user-portal' : '/sign-in'}>{isSignedIn ? t('nav.workspace') : t('nav.signIn')}</Link>
          <SitePreferences />
          <Link className="button button-primary" href="/launch">{t('nav.launch')} <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </motion.nav>}
      </AnimatePresence>
    </header>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <Link href="/" aria-label={t('brand.homeLink')}>
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand/logo-dark.svg`} width="216" height="40" alt={t('brand.logoAlt')} />
          </Link>
          <nav className="footer-links" aria-label={t('nav.footer')}>
            <Link href="/about">{t('nav.about')}</Link>
            <Link href="/projects">{t('nav.projects')}</Link>
            <Link href="/launch">{t('nav.launch')}</Link>
            <Link href="/privacy">{t('footer.privacy')}</Link>
            <Link href="/terms">{t('footer.terms')}</Link>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>{t('footer.tagline')}</span>
          <span>{t('footer.brand')}</span>
        </div>
      </div>
    </footer>
  );
}

function FAQ({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { t } = useTranslation();
  const localized = t('faq', { returnObjects: true }) as FaqItem[];
  const questions = compact ? localized.slice(0, 5) : localized;
  return (
    <div className="faq-list">
      {questions.map((item, index) => {
        const isOpen = expanded === index;
        const answerId = `faq-answer-${compact ? 'home' : 'about'}-${index}`;
        return (
          <div className="faq-item" key={item.question}>
            <button
              className="faq-question"
              type="button"
              aria-expanded={isOpen}
              aria-controls={answerId}
              onClick={() => setExpanded(isOpen ? null : index)}
              data-testid={`button-faq-${index}`}
            >
              <span>{item.question}</span>
              <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <p className="faq-answer" id={answerId} data-testid={`text-faq-answer-${index}`}>
                {item.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const descriptionTag = document.querySelector('meta[name="description"]');
    if (descriptionTag) descriptionTag.setAttribute('content', description);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', description);
  }, [title, description]);
}

function Home() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [cueVisible, setCueVisible] = useState(true);
  useEffect(() => {
    const update = () => document.body.classList.toggle('tab-hidden', document.hidden);
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const update = () => {
      if (window.scrollY <= 4) setCueVisible(true);
      else if (window.scrollY > 80) setCueVisible(false);
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);
  usePageMeta(
    t('pages.homeTitle'),
    t('pages.description'),
  );
  return (
    <div className="site-shell">
      <Header />
      <main>
        <section className="hero">
          <div className="container">
            <div className="hero-top">
              <div>
                <span className="eyebrow">{t('home.eyebrow')}</span>
                <h1>
                  <span className="hero-line">{t('home.titleOne')}</span>
                  <em className="hero-line">{t('home.titleTwo')}</em>
                </h1>
              </div>
              <div className="hero-intro">
                <p>
                  {t('home.intro')}
                </p>
                <a className="button button-primary" href="#how-it-works">
                  {t('home.how')} <ArrowDownRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>
            <figure className="hero-art">
              <img
                src={`${import.meta.env.BASE_URL}brand/live-landing-crop.jpg`}
                width="1024"
                height="512"
                alt={t('brandHome.heroAlt')}
                fetchPriority="high"
              />
              <figcaption className="art-caption">{t('home.caption')}</figcaption>
            </figure>
            <a className={`hero-scroll-cue ${reduced ? 'is-static' : ''} ${cueVisible ? '' : 'is-hidden'}`} href="#how-it-works" aria-label={t('cue')} aria-hidden={!cueVisible} tabIndex={cueVisible ? undefined : -1} data-testid="link-hero-scroll-cue" onClick={(event) => {
              event.preventDefault();
              document.getElementById('how-it-works')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
            }}>{reduced ? <ArrowDown size={15} aria-hidden="true" /> : <span aria-hidden="true" />}<span>{t('cue')}</span></a>
          </div>
        </section>

        <EcosystemMarquee />
        <section className="audience-section" aria-labelledby="audience-heading">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandHome.twoSides')}</span>
              <h2 id="audience-heading">{t('brandHome.makeCount')}</h2>
            </div>
            <div className="audience-grid">
              <article className="audience-card">
                <span className="card-kicker">{t('brandHome.forCreators')}</span>
                <h3>{t('brandHome.getPaid')}</h3>
                <p>
                  {t('brandHome.creatorCard')}
                </p>
                <a className="button button-primary" href="/projects">
                  {t('brandHome.browse')} <ArrowRight size={16} aria-hidden="true" />
                </a>
              </article>
              <article className="audience-card">
                <span className="card-kicker">{t('brandHome.forOwners')}</span>
                <h3>{t('brandHome.payResults')}</h3>
                <p>
                  {t('brandHome.ownerCard')}
                </p>
                <a className="button button-outline" href="/launch">
                  {t('brandHome.launch')} <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="container steps-layout">
            <div className="steps-copy">
              <span className="eyebrow">{t('brandHome.path')}</span>
              <h2>{t('brandHome.how')}</h2>
              <p>{t('brandHome.journeyIntro')}</p>
            </div>
            <div className="journey-grid">
              <article className="journey-card">
                <span className="card-kicker">{t('brandHome.creators')}</span>
                <div className="journey-step">
                  <span>01</span><div><h3>{t('brandHome.join')}</h3><p>{t('brandHome.joinCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>02</span><div><h3>{t('brandHome.post')}</h3><p>{t('brandHome.postCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>03</span><div><h3>{t('brandHome.scored')}</h3><p>{t('brandHome.scoredCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>04</span><div><h3>{t('brandHome.paid')}</h3><p>{t('brandHome.paidCopy')}</p></div>
                </div>
              </article>
              <article className="journey-card">
                <span className="card-kicker">{t('brandHome.owners')}</span>
                <div className="journey-step">
                  <span>01</span><div><h3>{t('brandHome.launchStep')}</h3><p>{t('brandHome.launchCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>02</span><div><h3>{t('brandHome.creatorsPost')}</h3><p>{t('brandHome.creatorsPostCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>03</span><div><h3>{t('brandHome.resultsScored')}</h3><p>{t('brandHome.resultsScoredCopy')}</p></div>
                </div>
                <div className="journey-step">
                  <span>04</span><div><h3>{t('brandHome.rewardResults')}</h3><p>{t('brandHome.rewardResultsCopy')}</p></div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="why-section">
          <div className="container why-grid">
            <div className="why-title">
              <span className="eyebrow">{t('brandHome.whyEyebrow')}</span>
              <h2>{t('brandHome.whyTitle')}</h2>
            </div>
            <div className="why-points">
              <div className="why-point">
                <span>01</span>
                <p>{t('brandHome.point1')}</p>
              </div>
              <div className="why-point">
                <span>02</span>
                <p>{t('brandHome.point2')}</p>
              </div>
              <div className="why-point">
                <span>03</span>
                <p>{t('brandHome.point3')}</p>
              </div>
              <div className="why-point">
                <span>04</span>
                <p>{t('brandHome.point4')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-section">
          <div className="container proof-grid">
            <figure className="proof-image">
              <img
                src={`${import.meta.env.BASE_URL}brand/campaign-board-crop.jpg`}
                width="760"
                height="650"
                loading="lazy"
                alt={t('brandHome.boardAlt')}
              />
            </figure>
            <div className="proof-copy">
              <span className="eyebrow">{t('brandHome.board')}</span>
              <h2>{t('brandHome.boardTitle')}</h2>
              <p>
                {t('brandHome.boardCopy')}
              </p>
              <a className="button button-outline" href="/launch">
                {t('brandHome.explore')} <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="market-section">
          <div className="container">
            <div className="market-panel">
              <div className="market-copy">
                <span className="eyebrow">{t('brandHome.marketEyebrow')}</span>
                <h2>{t('brandHome.marketTitle')}</h2>
                <p>
                  {t('brandHome.marketCopy')}
                </p>
              </div>
              <aside className="market-note">
                <strong>{t('brandHome.dailyExtra')}</strong>
                <p>{t('brandHome.dailyCopy')}</p>
              </aside>
            </div>
          </div>
        </section>

        <section className="types-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandHome.buildEyebrow')}</span>
              <h2>{t('brandHome.buildTitle')}</h2>
            </div>
            <div className="type-cards">
              <article className="type-card">
                <span className="card-kicker">{t('brandHome.available')}</span>
                <h3>{t('brandHome.projectsBrands')}</h3>
                <p>{t('brandHome.projectCopy')}</p>
              </article>
              <article className="type-card">
                <span className="card-kicker">{t('brandHome.forCreators')}</span>
                <h3>{t('brandHome.participation')}</h3>
                <p>{t('brandHome.participationCopy')}</p>
              </article>
              <article className="type-card">
                <span className="coming">{t('brandHome.comingSoon')}</span>
                <h3>{t('brandHome.causeCampaigns')}</h3>
                <p>{t('brandHome.causeCopy')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faq-section">
          <div className="container faq-layout">
            <div className="faq-title">
              <span className="eyebrow">{t('brandHome.answers')}</span>
              <h2>{t('brandHome.questions')}</h2>
              <p>{t('brandHome.questionsCopy')}</p>
              <p className="beta-line">
                {t('brandHome.beta')}
              </p>
            </div>
            <FAQ compact />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-inner">
            <h2>{t('brandHome.ctaTitle')}</h2>
            <a className="button button-dark" href="/projects">
              {t('brandHome.exploreMarket')} <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function About() {
  const { t } = useTranslation();
  usePageMeta(
    `${t('pages.about')} | GG's`,
    t('pages.aboutDescription'),
  );
  return (
    <div className="site-shell">
      <Header />
      <main>
        <section className="about-hero">
          <div className="container">
            <span className="eyebrow">{t('brandAbout.heroEyebrow')}</span>
            <h1>
              {t('brandAbout.heroTitle')} <em>{t('brandAbout.heroEmphasis')}</em>
            </h1>
            <p className="about-intro">
              {t('brandAbout.heroIntro')}
            </p>
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-steps-heading">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandAbout.processEyebrow')}</span>
              <h2 id="about-steps-heading">{t('brandAbout.howWorks')}</h2>
            </div>
            <div className="about-steps">
              <article className="flow-card">
                <h3>{t('brandAbout.creators')}</h3>
                <div className="flow-step"><span>01</span><div><strong>{t('brandAbout.join')}</strong><p>{t('brandAbout.joinCopy')}</p></div></div>
                <div className="flow-step"><span>02</span><div><strong>{t('brandAbout.post')}</strong><p>{t('brandAbout.postCopy')}</p></div></div>
                <div className="flow-step"><span>03</span><div><strong>{t('brandAbout.scored')}</strong><p>{t('brandAbout.scoredCopy')}</p></div></div>
                <div className="flow-step"><span>04</span><div><strong>{t('brandAbout.paid')}</strong><p>{t('brandAbout.paidCopy')}</p></div></div>
              </article>
              <article className="flow-card">
                <h3>{t('brandAbout.owners')}</h3>
                <div className="flow-step"><span>01</span><div><strong>{t('brandAbout.launch')}</strong><p>{t('brandAbout.launchCopy')}</p></div></div>
                <div className="flow-step"><span>02</span><div><strong>{t('brandAbout.creatorsPost')}</strong><p>{t('brandAbout.creatorsPostCopy')}</p></div></div>
                <div className="flow-step"><span>03</span><div><strong>{t('brandAbout.resultsScored')}</strong><p>{t('brandAbout.resultsScoredCopy')}</p></div></div>
                <div className="flow-step"><span>04</span><div><strong>{t('brandAbout.rewardResults')}</strong><p>{t('brandAbout.rewardResultsCopy')}</p></div></div>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandAbout.audienceEyebrow')}</span>
              <h2>{t('brandAbout.whoTitle')}</h2>
            </div>
            <div className="who-grid">
              <article className="who-card">
                <span className="card-kicker">{t('brandAbout.create')}</span>
                <h3>{t('brandAbout.creatorTitle')}</h3>
                <p>{t('brandAbout.creatorAudience')}</p>
              </article>
              <article className="who-card">
                <span className="card-kicker">{t('brandAbout.promote')}</span>
                <h3>{t('brandAbout.brandTitle')}</h3>
                <p>{t('brandAbout.brandAudience')}</p>
              </article>
              <article className="who-card">
                <span className="coming">{t('brandAbout.comingSoon')}</span>
                <h3>{t('brandAbout.causeTitle')}</h3>
                <p>{t('brandAbout.causeAudience')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandAbout.difference')}</span>
              <h2>{t('brandAbout.rewardAttention')}</h2>
            </div>
            <table className="comparison">
              <thead>
                <tr><th scope="col">{t('brandAbout.approach')}</th><th scope="col">{t('brandAbout.rewards')}</th><th scope="col">{t('brandAbout.visibility')}</th></tr>
              </thead>
              <tbody>
                <tr><td>{t('brandAbout.flatFee')}</td><td>{t('brandAbout.fixedFee')}</td><td>{t('brandAbout.risk')}</td></tr>
                <tr><td>{t('brandAbout.taskPlatforms')}</td><td>{t('brandAbout.taskPoints')}</td><td>{t('brandAbout.farmable')}</td></tr>
                <tr><td>{t('brandAbout.gg')}</td><td>{t('brandAbout.poolShare')}</td><td>{t('brandAbout.visibleRules')}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandAbout.clearRules')}</span>
              <h2>{t('brandAbout.scoringTitle')}</h2>
            </div>
            <div className="scoring-panel">
              <h3>{t('brandAbout.engagementCounts')}</h3>
              <div>
                <p>
                  {t('brandAbout.scoringCopy')}
                </p>
                <div className="formula">{t('brandAbout.formula')}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">{t('brandAbout.feeEyebrow')}</span>
              <h2>{t('brandAbout.feeTitle')}</h2>
            </div>
            <div className="fee-row">
              <article className="fee-card">
                <strong>10%</strong>
                <p>{t('brandAbout.projectFee')}</p>
              </article>
              <article className="fee-card">
                <strong>{t('brandAbout.creatorFeeTitle')}</strong>
                <p>{t('brandAbout.creatorFee')}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="market-panel">
              <div className="market-copy">
                <span className="eyebrow">{t('brandAbout.emergingEyebrow')}</span>
                <h2>{t('brandAbout.emergingTitle')}</h2>
                <p>
                  {t('brandAbout.emergingCopy')}
                </p>
              </div>
              <aside className="market-note">
                <strong>{t('brandAbout.dailyTitle')}</strong>
                <p>{t('brandAbout.dailyCopy')}</p>
              </aside>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <p className="beta-line">
              {t('brandAbout.beta')}
            </p>
          </div>
        </section>

        <section className="faq-section">
          <div className="container faq-layout">
            <div className="faq-title">
              <span className="eyebrow">{t('brandAbout.faqEyebrow')}</span>
              <h2>{t('brandAbout.faqTitle')}</h2>
              <p>{t('brandAbout.faqCopy')}</p>
            </div>
            <FAQ />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-inner">
            <h2>{t('brandAbout.ctaTitle')}</h2>
            <div className="about-cta">
              <a className="button button-dark" href="/projects">
                {t('brandAbout.browse')} <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <a className="button button-outline" href="/projects">
                {t('brandAbout.launchCampaign')} <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export { Home as BrandHome, About as BrandAbout };
