'use client';

import { useSettings } from '@/contexts/SettingsContext';
import { PortfolioAsset, PortfolioSummary } from '@/types';
import { formatCurrency, formatPercent, getAssetTypeName, DisplayCurrency } from '@/lib/api';
import AssetLogo from '@/components/AssetLogo';

interface Props {
    metric: 'value' | 'invested' | 'unrealized' | 'realized';
    summary: PortfolioSummary;
    assets: PortfolioAsset[];
    displayCurrency: DisplayCurrency;
    onClose: () => void;
}

export default function PortfolioDetailsModal({ metric, summary, assets, displayCurrency, onClose }: Props) {
    const { t, settings } = useSettings();

    const formatValue = (value: number) => {
        if (displayCurrency === 'BTC') {
            return `₿ ${value.toFixed(6)}`;
        }
        return formatCurrency(value, displayCurrency);
    };

    // Helper to get top assets for breakdown
    const getTopAssets = (metric: 'value' | 'unrealized') => {
        if (!assets) return [];
        const sorted = [...assets].sort((a, b) => {
            if (metric === 'value') return b.current_value - a.current_value;
            // For PnL, sort by absolute impact but keep sign
            return Math.abs(b.unrealized_pnl) - Math.abs(a.unrealized_pnl);
        });
        return sorted.slice(0, 5); // Top 5
    };

    const renderDetailsContent = () => {
        if (metric === 'realized') {
            const breakdown = summary.realized_pnl_breakdown || {};
            const hasBreakdown = Object.keys(breakdown).length > 0;

            if (!hasBreakdown && summary.total_realized_pnl === 0) {
                return <div className="text-gray-400 text-center py-4">{t('ยังไม่มีกำไร/ขาดทุนที่รับรู้', 'No realized P&L yet')}</div>;
            }

            return (
                <div className="space-y-4">
                    <div className="text-sm text-gray-400 mb-2">{t('แยกตามสกุลเงินต้นทาง', 'Breakdown by Original Currency')}</div>
                    {hasBreakdown ? Object.entries(breakdown).map(([currency, amount]) => (
                        <div key={currency} className="flex justify-between items-center border-b border-gray-700/50 pb-2 last:border-0">
                            <span className="font-medium text-gray-300">{currency}</span>
                            <span className={`font-mono ${amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatCurrency(amount, currency as any)}
                            </span>
                        </div>
                    )) : (
                        <div className="text-gray-400 text-sm">
                            {t('แสดงยอดรวมจากการคำนวณแบบเก่า', 'Showing total from legacy calculation')}
                        </div>
                    )}
                </div>
            );
        }

        const metricAssets = getTopAssets(metric === 'value' || metric === 'invested' ? 'value' : 'unrealized');

        return (
            <div className="space-y-3">
                <div className="text-sm text-gray-400 mb-2">{t('5 อันดับแรก', 'Top 5 Assets')}</div>
                {metricAssets.map(asset => (
                    <div key={asset.symbol} className="flex items-center justify-between p-2 hover:bg-gray-700/30 rounded-lg transition-colors">
                        <div className="flex items-center gap-3">
                            <AssetLogo symbol={asset.symbol} assetType={asset.asset_type} size="sm" />
                            <div>
                                <div className="font-medium text-white">{asset.symbol}</div>
                                <div className="text-xs text-gray-500">
                                    {getAssetTypeName(asset.asset_type, settings.language)}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            {metric === 'unrealized' ? (
                                <>
                                    <div className={`font-mono text-sm ${asset.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {formatValue(asset.unrealized_pnl)}
                                    </div>
                                    <div className={`text-xs ${asset.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {formatPercent(asset.unrealized_pnl_percent)}
                                    </div>
                                </>
                            ) : (
                                <div className="font-mono text-white text-sm">
                                    {formatValue(asset.current_value)}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h3 className="font-semibold text-white">
                        {metric === 'value' && t('มูลค่าสินทรัพย์สูงสุด', 'Top Assets by Value')}
                        {metric === 'invested' && t('เงินลงทุนสูงสุด', 'Top Assets by Cost')}
                        {metric === 'unrealized' && t('กำไร/ขาดทุนสูงสุด', 'Top Movers')}
                        {metric === 'realized' && t('รายละเอียดกำไรที่รับรู้', 'Realized P&L Details')}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="p-4 max-h-[60vh] overflow-y-auto">
                    {renderDetailsContent()}
                </div>
            </div>
        </div>
    );
}
