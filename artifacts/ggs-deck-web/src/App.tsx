import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Keyboard,
  Minimize2,
  Printer,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const TOTAL_SLIDES = 12;
const SLIDE_SRC = '/deck-content/slide1?replitMotion=1&replitNav=parent';
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const PDF_PATH = `${BASE_PATH}/ggs-investor-pitch.pdf`;
const PRINT_PATH = `${BASE_PATH}/print`;

function PresentationPlayer() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [slide, setSlide] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [presenting, setPresenting] = useState(false);

  const goTo = useCallback((target: number) => {
    const next = Math.max(1, Math.min(TOTAL_SLIDES, target));
    setSlide(next);
    if (loaded) {
      frameRef.current?.contentWindow?.postMessage(
        { type: 'navigateToSlide', position: next },
        window.location.origin,
      );
    }
  }, [loaded]);

  const togglePresent = useCallback(async () => {
    if (!presenting) {
      setPresenting(true);
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        // Fullscreen can be unavailable in embedded previews; distraction-free mode still works.
      }
      return;
    }
    setPresenting(false);
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
  }, [presenting]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = event.data?.type;
      if (type === 'advanceSlide') goTo(slide + 1);
      if (type === 'retreatSlide') goTo(slide - 1);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ' && target?.closest('button, a')) return;
      if (event.key === 'Escape' && presenting) {
        setPresenting(false);
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        goTo(slide - 1);
      }
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        goTo(slide + 1);
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [goTo, presenting, slide]);

  return (
    <main className={`player-shell${presenting ? ' presenting' : ''}`} data-testid="presentation-player">
      <header className="player-header">
        <div className="brand-lockup" data-testid="text-brand">
          <span className="brand-mark" aria-hidden="true">gg</span>
          <div>
            <div className="brand-name">GG.ATTENTION</div>
            <div className="brand-context">Investor presentation · Celo</div>
          </div>
        </div>
        <div className="header-actions">
          <a
            className="control-button"
            href={PRINT_PATH}
            aria-label="Open print view"
            data-testid="button-open-print-view"
          >
            <Printer size={16} strokeWidth={1.8} />
            <span>Print</span>
          </a>
          <button
            type="button"
            className="control-button"
            onClick={togglePresent}
            aria-label="Enter distraction-free Present mode"
            data-testid="button-present-mode"
          >
            <Expand size={16} strokeWidth={1.8} />
            <span>Present</span>
          </button>
          <a
            className="control-button primary"
            href={PDF_PATH}
            download="GG-ATTENTION-Investor-Presentation.pdf"
            aria-label="Download as PDF"
            data-testid="button-download-pdf"
          >
            <Download size={16} strokeWidth={1.8} />
            <span className="download-label">Download as PDF</span>
          </a>
        </div>
      </header>
      <button
        type="button"
        className="control-button icon-button present-exit"
        onClick={togglePresent}
        aria-label="Exit Present mode"
        data-testid="button-exit-present"
      >
        <Minimize2 size={17} />
      </button>
      <section className="slide-stage" aria-label="Presentation slide">
        {!loaded && (
          <div className="slide-skeleton" aria-label="Loading presentation">
            <div className="skeleton-rule" />
            <div className="skeleton-block" />
            <div className="skeleton-block short" />
          </div>
        )}
        <iframe
          ref={frameRef}
          className={`slide-frame${loaded ? '' : ' is-loading'}`}
          title={`GG.ATTENTION investor presentation, slide ${slide} of ${TOTAL_SLIDES}`}
          src={SLIDE_SRC}
          onLoad={() => {
            setLoaded(true);
            frameRef.current?.contentWindow?.postMessage(
              { type: 'navigateToSlide', position: slide },
              window.location.origin,
            );
          }}
          allow="fullscreen"
          data-testid="presentation-slide"
        />
        <div className="slide-progress" style={{ width: `${(slide / TOTAL_SLIDES) * 100}%` }} />
      </section>
      <footer className="player-footer">
        <div className="slide-count" aria-live="polite" data-testid="text-slide-count">
          <strong>{String(slide).padStart(2, '0')}</strong>
          <span>/</span>
          <span>{String(TOTAL_SLIDES).padStart(2, '0')}</span>
        </div>
        <div className="key-hint">
          <Keyboard size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Use arrow keys to move through the deck
        </div>
        <div className="nav-cluster">
          <button
            type="button"
            className="control-button icon-button"
            onClick={() => goTo(slide - 1)}
            disabled={slide === 1}
            aria-label="Previous slide"
            data-testid="button-previous-slide"
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            className="control-button icon-button"
            onClick={() => goTo(slide + 1)}
            disabled={slide === TOTAL_SLIDES}
            aria-label="Next slide"
            data-testid="button-next-slide"
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </footer>
    </main>
  );
}

function PdfPrintView() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [, navigate] = useLocation();

  return (
    <main className="pdf-shell" data-testid="pdf-print-view">
      <header className="pdf-topbar">
        <div>
          <h1 className="pdf-title">GG.ATTENTION — investor presentation</h1>
          <p className="pdf-note">The complete 12-slide PDF is ready to print.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="control-button" onClick={() => navigate('/')} data-testid="button-back-to-deck">
            <ArrowLeft size={16} /> Back to deck
          </button>
          <button
            type="button"
            className="control-button primary"
            onClick={() => {
              try {
                frameRef.current?.contentWindow?.focus();
                frameRef.current?.contentWindow?.print();
              } catch {
                window.print();
              }
            }}
            disabled={!ready}
            data-testid="button-print-save-pdf"
          >
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </header>
      {!ready && <div className="pdf-loading" role="status">Loading the presentation PDF…</div>}
      <iframe
        ref={frameRef}
        className="print-frame"
        title="GG.ATTENTION investor presentation PDF"
        src={PDF_PATH}
        onLoad={() => setReady(true)}
        data-testid="print-source-slides"
      />
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={PresentationPlayer} />
        <Route path="/print" component={PdfPrintView} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
