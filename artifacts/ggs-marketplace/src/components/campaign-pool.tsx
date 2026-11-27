import type { Campaign } from '@workspace/api-client-react';
import { formatEther } from 'viem';
import { celoPoolDisplay } from '@/lib/campaign-pool';
import i18n from '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import { formatExactDecimal } from '@/lib/locale-format';

export function CampaignPool({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  if (campaign.rewardAsset !== 'CELO') {
    return <><p className="font-mono text-sm">{new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(campaign.pool)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t('campaignPool.pool')}</p></>;
  }
  const { target, deposit } = celoPoolDisplay(campaign, t('motionUI.legacyTarget'));
  const unavailable = campaign.rewardStatus !== 'draft' && !deposit;
  const usdAtFunding = campaign.usdTargetAmount
    ? new Intl.NumberFormat(i18n.resolvedLanguage || 'en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(campaign.usdTargetAmount))
    : null;
  const unconfirmedTarget = campaign.rewardStatus === 'draft' && Boolean(campaign.celoTargetAmount);
  return (
    <div className="space-y-1" data-testid={`campaign-celo-amounts-${campaign.id}`}>
       <p className="font-mono text-sm font-medium" data-testid={`campaign-deposit-${campaign.id}`}>{deposit ?? (unconfirmedTarget ? target : unavailable ? t('campaignPool.unavailable') : t('campaignPool.notFunded'))}</p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{deposit ? t('campaignPool.confirmed') : unavailable ? t('campaignPool.amountUnavailable') : t('campaignPool.draft')}</p>
        {usdAtFunding && deposit && <p className="text-xs text-muted-foreground" data-testid={`campaign-usd-at-funding-${campaign.id}`}>{t('paymentDetails.usdAtFunding', { amount: usdAtFunding })}</p>}
        {deposit && <p className="font-mono text-xs" data-testid={`campaign-remaining-${campaign.id}`}>{t('campaignPool.remaining', { amount: formatExactDecimal(formatEther(BigInt(campaign.celoRemainingRaw))) })}</p>}
    </div>
  );
}