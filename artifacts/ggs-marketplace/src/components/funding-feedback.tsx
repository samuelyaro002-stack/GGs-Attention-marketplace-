import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/** Mounted only after an actual successful funding receipt and marketplace sync. */
export function FundingSuccess({ message }: { message: string }) {
  const { t } = useTranslation();
  return <div className="funding-success" role="status" data-testid="status-funding-confirmed">
    <span className="funding-success-mark" aria-hidden="true"><Check size={20} /></span>
    <div><p>{message}</p><p className="mt-1">{t('motionUI.fundingNext')}</p></div>
    <span className="funding-confetti" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <i key={index} style={{ '--piece': index } as CSSProperties} />)}
    </span>
  </div>;
}
