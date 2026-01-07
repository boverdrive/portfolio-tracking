'use client';

import { PortfolioAsset } from '@/types';
import { formatCurrency, formatPercent, formatNumber, getAssetTypeName, getMarketName, DisplayCurrency } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';
import AssetLogo from '@/components/AssetLogo';

interface Props {
    assets: PortfolioAsset[];
    isLoading?: boolean;
    displayCurrency?: DisplayCurrency;
}

export default function AssetList({ assets, isLoading, displayCurrency = 'THB' }: Props) {
    const { t, settings } = useSettings();

    const formatValue = (value: number) => {
        if (displayCurrency === 'BTC') {
            return `₿ ${value.toFixed(6)}`;
        }
        return formatCurrency(value, displayCurrency);
    };

    if (isLoading) {
        return (
            <div className="bg-gray-800/50 rounded-xl overflow-hidden">
                <div className="p-6 animate-pulse">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center gap-4 py-4 border-b border-gray-700/50 last:border-0">
                            <div className="w-10 h-10 bg-gray-700 rounded-full"></div>
                            <div className="flex-1">
                                <div className="h-4 bg-gray-700 rounded w-24 mb-2"></div>
                                <div className="h-3 bg-gray-700 rounded w-16"></div>
                            </div>
                            <div className="text-right">
                                <div className="h-4 bg-gray-700 rounded w-20 mb-2"></div>
                                <div className="h-3 bg-gray-700 rounded w-14"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (assets.length === 0) {
        return (
            <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl p-12 border border-gray-700/50 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">{t('ยังไม่มีสินทรัพย์', 'No Assets Yet')}</h3>
                <p className="text-gray-500 text-sm">{t('เพิ่มรายการซื้อขายเพื่อเริ่มติดตามพอร์ตโฟลิโอของคุณ', 'Add transactions to start tracking your portfolio')}</p>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden shadow-xl">
            {/* Header */}
            <div className="flex px-6 py-4 bg-gray-700/30 text-sm font-medium text-gray-400 border-b border-gray-700/50">
                <div className="w-[180px] flex-shrink-0">{t('สินทรัพย์', 'Asset')}</div>
                <div className="w-[100px] flex-shrink-0 text-right">{t('จำนวน', 'Quantity')}</div>
                <div className="flex-1 min-w-[150px] text-right">{t('ต้นทุนเฉลี่ย', 'Avg Cost')}</div>
                <div className="flex-1 min-w-[150px] text-right">{t('ราคาปัจจุบัน', 'Current Price')}</div>
                <div className="w-[140px] flex-shrink-0 text-right">{t('กำไร/ขาดทุน', 'P&L')}</div>
            </div>

            {/* Asset rows */}
            <div className="divide-y divide-gray-700/50">
                {assets.map((asset, index) => {
                    const pnlColor = asset.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
                    const bgHover = asset.unrealized_pnl >= 0
                        ? 'hover:bg-emerald-500/5'
                        : 'hover:bg-rose-500/5';

                    return (
                        <div
                            key={`${asset.asset_type}-${asset.market || ''}-${asset.symbol}`}
                            className={`flex px-6 py-4 items-center transition-colors ${bgHover}`}
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            {/* Symbol */}
                            <div className="w-[180px] flex-shrink-0 flex items-center gap-3">
                                <AssetLogo symbol={asset.symbol} assetType={asset.asset_type} size="md" />
                                <div>
                                    <div className="font-semibold text-white">{asset.symbol}</div>
                                    <div className="text-xs text-gray-500">
                                        {getAssetTypeName(asset.asset_type, settings.language)}
                                        {asset.market && <span className="ml-1">• {getMarketName(asset.market, settings.language).split(' ')[0]}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Quantity */}
                            <div className="w-[100px] flex-shrink-0 text-right font-mono text-gray-300">
                                {formatNumber(asset.quantity, asset.asset_type === 'crypto' ? 8 : 2)}
                            </div>

                            {/* Average Cost + Fees */}
                            <div className="flex-1 min-w-[150px] text-right">
                                <div className="font-mono text-gray-300 whitespace-nowrap">{formatValue(asset.avg_cost)}</div>
                                {asset.total_fees > 0 && (
                                    <div className="text-xs text-gray-500">
                                        {t('ค่าธรรมเนียม', 'Fees')}: {formatValue(asset.total_fees)}
                                    </div>
                                )}
                            </div>

                            {/* Current Price */}
                            <div className="flex-1 min-w-[150px] text-right">
                                <div className="font-mono text-white flex items-center justify-end gap-1 whitespace-nowrap">
                                    {formatValue(asset.current_price)}
                                    <span className={`text-xs ${pnlColor}`}>
                                        {asset.current_price > asset.avg_cost ? '▲' : asset.current_price < asset.avg_cost ? '▼' : '—'}
                                    </span>
                                </div>
                            </div>

                            {/* P&L */}
                            <div className="w-[140px] flex-shrink-0 text-right">
                                <div className={`font-semibold ${pnlColor}`}>
                                    {formatValue(asset.unrealized_pnl)}
                                </div>
                                <div className={`text-sm ${pnlColor}`}>
                                    {formatPercent(asset.unrealized_pnl_percent)}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
