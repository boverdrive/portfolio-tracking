'use client';

import { useState } from 'react';
import { PortfolioSummary as PortfolioSummaryType, PortfolioAsset } from '@/types';
import { formatCurrency, formatPercent, DisplayCurrency, getAssetTypeName, getMarketName } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';
import AssetLogo from '@/components/AssetLogo';

interface Props {
    summary: PortfolioSummaryType;
    assets?: PortfolioAsset[];
    isLoading?: boolean;
    displayCurrency?: DisplayCurrency;
    onMetricSelect?: (metric: 'value' | 'invested' | 'unrealized' | 'realized') => void;
}

export default function PortfolioSummary({ summary, assets = [], isLoading, displayCurrency = 'THB', onMetricSelect }: Props) {
    const { t, settings } = useSettings();

    const formatValue = (value: number) => {
        if (displayCurrency === 'BTC') {
            return `₿ ${value.toFixed(6)}`;
        }
        return formatCurrency(value, displayCurrency);
    };

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-gray-800/50 rounded-xl p-6 animate-pulse">
                        <div className="h-4 bg-gray-700 rounded w-1/2 mb-3"></div>
                        <div className="h-8 bg-gray-700 rounded w-3/4"></div>
                    </div>
                ))}
            </div>
        );
    }

    const pnlColor = summary.total_unrealized_pnl >= 0
        ? 'text-emerald-400'
        : 'text-rose-400';

    const pnlBgColor = summary.total_unrealized_pnl >= 0
        ? 'bg-emerald-500/10 border-emerald-500/20'
        : 'bg-rose-500/10 border-rose-500/20';

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Value */}
            <div
                onClick={() => onMetricSelect?.('value')}
                className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50 shadow-lg cursor-pointer hover:border-emerald-500/30 hover:shadow-emerald-500/10 transition-all group"
            >
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2 group-hover:text-emerald-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('มูลค่าปัจจุบัน', 'Current Value')}
                </div>
                <div className="text-2xl font-bold text-white group-hover:scale-105 origin-left transition-transform">
                    {formatValue(summary.total_current_value)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                    {summary.assets_count} {t('สินทรัพย์', 'assets')}
                </div>
            </div>

            {/* Total Invested */}
            <div
                onClick={() => onMetricSelect?.('invested')}
                className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50 shadow-lg cursor-pointer hover:border-blue-500/30 hover:shadow-blue-500/10 transition-all group"
            >
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2 group-hover:text-blue-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {t('เงินลงทุนรวม', 'Total Invested')}
                </div>
                <div className="text-2xl font-bold text-white group-hover:scale-105 origin-left transition-transform">
                    {formatValue(summary.total_invested)}
                </div>
            </div>

            {/* Unrealized P&L */}
            <div
                onClick={() => onMetricSelect?.('unrealized')}
                className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl p-6 border shadow-lg cursor-pointer transition-all group ${pnlBgColor} hover:brightness-110`}
            >
                <div className={`flex items-center gap-2 text-sm mb-2 ${summary.total_unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    {t('กำไร/ขาดทุน ยังไม่ขาย', 'Unrealized P&L')}
                </div>
                <div className={`text-2xl font-bold ${pnlColor} group-hover:scale-105 origin-left transition-transform`}>
                    {formatValue(summary.total_unrealized_pnl)}
                </div>
                <div className={`text-sm ${pnlColor}`}>
                    {formatPercent(summary.total_unrealized_pnl_percent)}
                </div>
            </div>

            {/* Realized P&L */}
            <div
                onClick={() => onMetricSelect?.('realized')}
                className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50 shadow-lg cursor-pointer hover:border-purple-500/30 hover:shadow-purple-500/10 transition-all group"
            >
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2 group-hover:text-purple-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('กำไร/ขาดทุน ที่รับรู้แล้ว', 'Realized P&L')}
                </div>
                <div className={`text-2xl font-bold group-hover:scale-105 origin-left transition-transform ${summary.total_realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatValue(summary.total_realized_pnl)}
                </div>
            </div>
        </div>
    );
}
