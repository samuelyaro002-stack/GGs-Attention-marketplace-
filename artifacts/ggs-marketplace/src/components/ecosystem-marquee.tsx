import { useTranslation } from 'react-i18next';

/** Technology wordmarks, not an assertion of sponsorship or partnership. */
export function EcosystemMarquee() {
  const { t } = useTranslation();
  return <section className="ecosystem-strip" aria-label={t('motionUI.ecosystem')} data-testid="section-ecosystem">
    <span className="ecosystem-label">{t('motionUI.ecosystem')}</span>
    <div className="ecosystem-window">
      <div className="ecosystem-track">
        {[0, 1].map(group => <div className="ecosystem-group" key={group} aria-hidden={group === 1 || undefined}>
          <span className="ecosystem-wordmark">celo</span><span className="ecosystem-wordmark">G$ GoodDollar</span>
          <span className="ecosystem-wordmark">celo</span><span className="ecosystem-wordmark">G$ GoodDollar</span>
        </div>)}
      </div>
    </div>
  </section>;
}
