import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';

const logoSrc = `${import.meta.env.BASE_URL}brand/logo.svg`;

const faqItems = [
  {
    question: "What is GG's?",
    answer:
      "GG's is an attention marketplace. Campaign owners fund a reward pool, creators post about a campaign, and the pool is shared according to how their content performs.",
  },
  {
    question: 'Who is it for?',
    answer:
      "Creators can earn from measured campaign performance. Projects and brands can reward the attention and engagement their campaigns receive.",
  },
  {
    question: 'How do I get paid?',
    answer:
      'When a campaign pays out, your reward is sent straight to your wallet. There is no claim step and creators pay no fee to receive rewards.',
  },
  {
    question: 'When do I get paid?',
    answer:
      'Payout timing is shown on each campaign. Scores are reviewed before payouts are sent.',
  },
  {
    question: 'How is my score calculated?',
    answer:
      'Likes, reposts and replies are weighted, with a trust factor. Your payout is the pool times your score divided by everyone’s total score.',
  },
  {
    question: 'What if I disagree with my score?',
    answer:
      'Creators can flag a score before payouts go out. The campaign team reviews flagged scores during the review window.',
  },
  {
    question: 'Do I need crypto experience?',
    answer:
      "You do not need prior crypto experience to explore campaigns. A wallet is needed to receive rewards when you participate.",
  },
  {
    question: 'What is Daily G$?',
    answer:
      'Daily G$ is a basic income benefit for verified users. It is an extra benefit, separate from campaign rewards.',
  },
];

function Header() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => setOpen(false), [location]);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" aria-label="GG's home">
          <img className="brand-logo" src={logoSrc} width="216" height="40" alt="GG Attention" />
        </Link>
        <nav className="nav-links" aria-label="Main navigation">
          <Link href="/about">About GG's</Link>
          <a href="/projects">Explore campaigns</a>
        </nav>
        <div className="nav-actions">
          <a className="button button-primary" href="/projects">
            Launch a campaign <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
        <button
          className="menu-toggle"
          type="button"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen((value) => !value)}
          data-testid="button-mobile-menu"
        >
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      {open && (
        <nav className="mobile-menu" id="mobile-navigation" aria-label="Mobile navigation">
          <Link href="/about">About GG's</Link>
          <a href="/projects">Explore campaigns</a>
          <a className="button button-primary" href="/projects">
            Launch a campaign <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <Link href="/" aria-label="GG's home">
            <img className="brand-logo" src={logoSrc} width="216" height="40" alt="GG Attention" />
          </Link>
          <nav className="footer-links" aria-label="Footer navigation">
            <Link href="/about">About GG's</Link>
            <a href="/projects">Browse campaigns</a>
            <a href="/projects">Launch a campaign</a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>Attention, shared fairly.</span>
          <span>GG's Attention Marketplace</span>
        </div>
      </div>
    </footer>
  );
}

function FAQ({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const questions = compact ? faqItems.slice(0, 5) : faqItems;
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
  usePageMeta(
    "GG's Attention Marketplace | Get paid for attention",
    "GG's connects creators and campaign owners. Creators earn from measured campaign performance, while campaign owners reward results.",
  );
  return (
    <div className="site-shell">
      <Header />
      <main>
        <section className="hero">
          <div className="container">
            <div className="hero-top">
              <div>
                <span className="eyebrow">Attention marketplace · Beta</span>
                <h1>
                  Attention is an asset.
                  <br />
                  <em>Put it to work.</em>
                </h1>
              </div>
              <div className="hero-intro">
                <p>
                  GG's connects creators and campaign owners, making attention something you can
                  measure, reward and share.
                </p>
                <a className="button button-primary" href="#how-it-works">
                  See how it works <ArrowDownRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>
            <figure className="hero-art">
              <img
                src={`${import.meta.env.BASE_URL}brand/live-landing-crop.jpg`}
                width="1024"
                height="512"
                alt="GG's marketplace interface with the message Attention is an asset. Put it to work."
                fetchPriority="high"
              />
              <figcaption className="art-caption">A better measure of what attention earns.</figcaption>
            </figure>
          </div>
        </section>

        <section className="audience-section" aria-labelledby="audience-heading">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Two sides. One marketplace.</span>
              <h2 id="audience-heading">Make attention count.</h2>
            </div>
            <div className="audience-grid">
              <article className="audience-card">
                <span className="card-kicker">For creators</span>
                <h3>Get paid for the attention you create.</h3>
                <p>
                  Join a campaign, post about it, and earn a share of the reward pool based on how
                  your content performs. Rewards go straight to your wallet. No claiming and no fees
                  to receive them.
                </p>
                <a className="button button-primary" href="/projects">
                  Browse campaigns <ArrowRight size={16} aria-hidden="true" />
                </a>
              </article>
              <article className="audience-card">
                <span className="card-kicker">For campaign owners</span>
                <h3>Pay for results, not promises.</h3>
                <p>
                  Fund a campaign, write your brief, and reward creators by the engagement their
                  posts actually earn. You can see who earned what.
                </p>
                <a className="button button-outline" href="/projects">
                  Launch a campaign <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="container steps-layout">
            <div className="steps-copy">
              <span className="eyebrow">A clear path from post to payout</span>
              <h2>How it works</h2>
              <p>Two ways in. The same simple idea: reward the attention that earns.</p>
            </div>
            <div className="journey-grid">
              <article className="journey-card">
                <span className="card-kicker">Creators</span>
                <div className="journey-step">
                  <span>01</span><div><h3>Join a campaign</h3><p>Review the brief, reward pool and scoring rules before you join.</p></div>
                </div>
                <div className="journey-step">
                  <span>02</span><div><h3>Post</h3><p>Share about the campaign in your own voice.</p></div>
                </div>
                <div className="journey-step">
                  <span>03</span><div><h3>Get scored</h3><p>Likes, reposts and replies are weighted with a trust factor.</p></div>
                </div>
                <div className="journey-step">
                  <span>04</span><div><h3>Get paid</h3><p>Your reward reflects your score against everyone's total score.</p></div>
                </div>
              </article>
              <article className="journey-card">
                <span className="card-kicker">Campaign owners</span>
                <div className="journey-step">
                  <span>01</span><div><h3>Launch a campaign</h3><p>Set a clear brief and fund its reward pool.</p></div>
                </div>
                <div className="journey-step">
                  <span>02</span><div><h3>Creators post</h3><p>Creators make content for their audiences based on your brief.</p></div>
                </div>
                <div className="journey-step">
                  <span>03</span><div><h3>Results get scored</h3><p>Engagement is measured using the campaign's scoring rules.</p></div>
                </div>
                <div className="journey-step">
                  <span>04</span><div><h3>Reward results</h3><p>See who earned what as the reward pool is paid out.</p></div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="why-section">
          <div className="container why-grid">
            <div className="why-title">
              <span className="eyebrow">More signal, less guesswork</span>
              <h2>Why GG's?</h2>
            </div>
            <div className="why-points">
              <div className="why-point">
                <span>01</span>
                <p>Unlike flat-fee influencer deals, creators know the scoring rules and their share before they post.</p>
              </div>
              <div className="why-point">
                <span>02</span>
                <p>Unlike generic task platforms, rewards are tied to measured performance, not just task completion.</p>
              </div>
              <div className="why-point">
                <span>03</span>
                <p>Creators and campaign owners can see how rewards are earned and where payouts go.</p>
              </div>
              <div className="why-point">
                <span>04</span>
                <p>Campaign owners pay a 10 percent platform fee when funding. Creators pay nothing to receive rewards.</p>
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
                alt="Campaign board preview showing example campaign listings in GG's marketplace."
              />
            </figure>
            <div className="proof-copy">
              <span className="eyebrow">The campaign board</span>
              <h2>A clear brief. A visible reward pool.</h2>
              <p>
                Campaign owners set the direction and creators decide what fits. The campaign board
                makes room for the details that matter before you take part.
              </p>
              <a className="button button-outline" href="/projects">
                Explore campaigns <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="market-section">
          <div className="container">
            <div className="market-panel">
              <div className="market-copy">
                <span className="eyebrow">Built for where creators are</span>
                <h2>Made for emerging-market creators, starting with Africa.</h2>
                <p>
                  Creator economies are growing everywhere. GG's is built to help creators in
                  emerging markets take part, earn from campaign performance and build with their
                  communities.
                </p>
              </div>
              <aside className="market-note">
                <strong>Daily G$ is an extra.</strong>
                <p>Daily G$ basic income is available only to verified users.</p>
              </aside>
            </div>
          </div>
        </section>

        <section className="types-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">What you can build</span>
              <h2>Campaigns with a point of view.</h2>
            </div>
            <div className="type-cards">
              <article className="type-card">
                <span className="card-kicker">Available now</span>
                <h3>Projects and brands</h3>
                <p>Give creators a clear brief and reward the attention their posts earn.</p>
              </article>
              <article className="type-card">
                <span className="card-kicker">For creators</span>
                <h3>Campaign participation</h3>
                <p>Browse opportunities and choose the campaigns that fit your voice.</p>
              </article>
              <article className="type-card">
                <span className="coming">Coming soon</span>
                <h3>Cause or social campaigns</h3>
                <p>Support for groups and individuals building attention around a cause is on the way.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="faq-section">
          <div className="container faq-layout">
            <div className="faq-title">
              <span className="eyebrow">Plain answers</span>
              <h2>Good questions.</h2>
              <p>Get the basics before you join a campaign or start one.</p>
              <p className="beta-line">
                Beta: scoring currently uses demo engagement data until social platform connections
                go live.
              </p>
            </div>
            <FAQ compact />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-inner">
            <h2>Attention has value. Put yours to work.</h2>
            <a className="button button-dark" href="/projects">
              Explore the marketplace <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function About() {
  usePageMeta(
    "About GG's | How the Attention Marketplace works",
    "Learn how GG's connects creators and campaign owners, how performance scoring works, how rewards are shared and what fees apply.",
  );
  return (
    <div className="site-shell">
      <Header />
      <main>
        <section className="about-hero">
          <div className="container">
            <span className="eyebrow">What is GG's?</span>
            <h1>
              Attention that gets paid for <em>what it earns.</em>
            </h1>
            <p className="about-intro">
              GG's connects people who want attention with creators who can earn it. Campaign owners
              fund a reward pool. Creators post. The pool is shared by how each creator's content
              performs. Everyone can see the rules and the split before they start.
            </p>
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-steps-heading">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">The process</span>
              <h2 id="about-steps-heading">How it works</h2>
            </div>
            <div className="about-steps">
              <article className="flow-card">
                <h3>Creators</h3>
                <div className="flow-step"><span>01</span><div><strong>Join</strong><p>Choose a campaign and review its brief, reward pool and scoring rules.</p></div></div>
                <div className="flow-step"><span>02</span><div><strong>Post</strong><p>Share content about the campaign in your own voice.</p></div></div>
                <div className="flow-step"><span>03</span><div><strong>Get scored</strong><p>Likes, reposts and replies count, weighted with a trust factor.</p></div></div>
                <div className="flow-step"><span>04</span><div><strong>Get paid</strong><p>Your share is sent to your wallet after the review window.</p></div></div>
              </article>
              <article className="flow-card">
                <h3>Campaign owners</h3>
                <div className="flow-step"><span>01</span><div><strong>Launch</strong><p>Set up a campaign with a clear brief and reward pool.</p></div></div>
                <div className="flow-step"><span>02</span><div><strong>Creators post</strong><p>Creators make content that speaks to their audience.</p></div></div>
                <div className="flow-step"><span>03</span><div><strong>Results are scored</strong><p>Performance is measured by weighted engagement and a trust factor.</p></div></div>
                <div className="flow-step"><span>04</span><div><strong>Reward results</strong><p>See who earned what as the pool is paid out by performance.</p></div></div>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">A marketplace for people making things happen</span>
              <h2>Who it's for</h2>
            </div>
            <div className="who-grid">
              <article className="who-card">
                <span className="card-kicker">Create</span>
                <h3>Creators</h3>
                <p>People who make content and want to earn from the attention and engagement it brings.</p>
              </article>
              <article className="who-card">
                <span className="card-kicker">Promote</span>
                <h3>Projects and brands that want creators</h3>
                <p>Teams looking for creators to tell their story and reward the results of their campaigns.</p>
              </article>
              <article className="who-card">
                <span className="coming">Coming soon</span>
                <h3>Groups and individuals building attention for a cause</h3>
                <p>Cause or social campaigns are not available yet.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">The difference</span>
              <h2>Reward what earns attention.</h2>
            </div>
            <table className="comparison">
              <thead>
                <tr><th scope="col">Approach</th><th scope="col">How rewards work</th><th scope="col">What you can see</th></tr>
              </thead>
              <tbody>
                <tr><td>Flat-fee influencer deals</td><td>Fixed fee for a creator post.</td><td>The brand carries all the risk.</td></tr>
                <tr><td>Task platforms</td><td>Points for completing tasks.</td><td>Easy to farm, often disconnected from performance.</td></tr>
                <tr><td>GG's</td><td>Share of a pool based on performance.</td><td>Scoring is shown before you join, and payouts are visible.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Clear rules before you post</span>
              <h2>How scoring works</h2>
            </div>
            <div className="scoring-panel">
              <h3>Engagement counts. Trust gives it context.</h3>
              <div>
                <p>
                  GG's scores likes, reposts and replies, weighted with a trust factor. Each
                  campaign shows its scoring rules before a creator joins.
                </p>
                <div className="formula">Your payout = pool × your score ÷ everyone's total score</div>
              </div>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Straightforward fees</span>
              <h2>Know what goes where.</h2>
            </div>
            <div className="fee-row">
              <article className="fee-card">
                <strong>10%</strong>
                <p>Campaign owners pay a 10 percent platform fee when funding.</p>
              </article>
              <article className="fee-card">
                <strong>0% creator fee</strong>
                <p>Creators pay nothing to receive rewards.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="about-section alt">
          <div className="container">
            <div className="market-panel">
              <div className="market-copy">
                <span className="eyebrow">The next generation is everywhere</span>
                <h2>Built for creators in emerging markets, starting with Africa.</h2>
                <p>
                  GG's is focused on making it easier for creators in emerging markets to take part
                  in the creator economy and earn from the attention they build.
                </p>
              </div>
              <aside className="market-note">
                <strong>Daily G$ basic income</strong>
                <p>Daily G$ is an extra benefit for verified users only.</p>
              </aside>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="container">
            <p className="beta-line">
              Beta: scoring currently uses demo engagement data until social platform connections
              go live.
            </p>
          </div>
        </section>

        <section className="faq-section">
          <div className="container faq-layout">
            <div className="faq-title">
              <span className="eyebrow">A few details</span>
              <h2>Frequently asked.</h2>
              <p>Clear answers about joining, scoring and rewards.</p>
            </div>
            <FAQ />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-inner">
            <h2>Find your next campaign, or bring one to life.</h2>
            <div className="about-cta">
              <a className="button button-dark" href="/projects">
                Browse campaigns <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <a className="button button-outline" href="/projects">
                Launch a campaign <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function NotFound() {
  usePageMeta("Page not found | GG's", "The page you are looking for could not be found.");
  return (
    <div className="site-shell">
      <Header />
      <main className="about-hero">
        <div className="container">
          <span className="eyebrow">404 / Not found</span>
          <h1>That page isn't here.</h1>
          <p className="about-intro">Try the homepage or explore campaigns in the marketplace.</p>
          <div className="about-cta">
            <Link className="button button-dark" href="/">Back to home</Link>
            <a className="button button-outline" href="/projects">Browse campaigns</a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

export default App;
