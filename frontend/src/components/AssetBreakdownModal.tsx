import React from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { formatCurrency, formatNumber, getAssetTypeName } from '@/lib/api';
import AssetLogo from '@/components/AssetLogo';

// Helper to determine if an asset type is "Futures" (using Margin)
const isFuturesType = (type: string) => {
    return type === 'tfex' || type === 'crypto_futures';
};

export interface BreakdownAsset {
    symbol: string;
    assetType: string;
    quantity: number;
    value: number; // The value used in breakdown (Margin or Market Value)
    currency: string; // Original currency of the value
    displayValue: number; // Converted to display currency (optional, or we convert in modal)
}

interface Props {
    title: string;
    type: string;
    assets: BreakdownAsset[];
    displayCurrency: string;
    onClose: () => void;
}

export default function AssetBreakdownModal({ title, type, assets, displayCurrency, onClose }: Props) {
    const { t, settings } = useSettings();

    // Sort by value descending
    const sortedAssets = [...assets].sort((a, b) => b.value - a.value);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getColorForType(type) }}
                        />
                        <h3 className="font-semibold text-white">
                            {title}
                        </h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 bg-gray-750/30 border-b border-gray-700/50">
                    <p className="text-xs text-gray-400">
                        {isFuturesType(type)
                            ? t('แสดงยอดจาก Initial Margin (เงินหลักประกัน)', 'Showing Initial Margin value')
                            : t('แสดงยอดจากมูลค่าตลาดปัจจุบัน', 'Showing Current Market Value')
                        }
                    </p>
                </div>

                <div className="p-2 max-h-[60vh] overflow-y-auto">
                    {sortedAssets.map(asset => (
                        <div key={asset.symbol} className="flex items-center justify-between p-3 hover:bg-gray-700/30 rounded-lg transition-colors group">
                            <div className="flex items-center gap-3">
                                <AssetLogo symbol={asset.symbol} assetType={asset.assetType === 'crypto_futures' ? 'crypto' : asset.assetType} size="sm" />
                                <div>
                                    <div className="font-medium text-white flex items-center gap-2">
                                        {asset.symbol}
                                        {asset.quantity < 0 && <span className="text-xs bg-rose-500/20 text-rose-400 px-1.5 rounded">Short</span>}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {formatNumber(Math.abs(asset.quantity))} {isFuturesType(type) ? 'Contracts' : 'Units'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-white text-sm font-bold">
                                    {formatCurrency(asset.displayValue, displayCurrency)}
                                </div>
                            </div>
                        </div>
                    ))}

                    {sortedAssets.length === 0 && (
                        <div className="p-8 text-center text-gray-500">
                            No assets found
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Reuse colors from AssetTypeBreakdown (duplicate for now or move to simpler shared const)
const getColorForType = (type: string) => {
    const COLORS: Record<string, string> = {
        'tfex': '#10B981',
        'stock': '#3B82F6',
        'crypto': '#F59E0B',
        'crypto_futures': '#EC4899',
        'foreign_stock': '#EF4444',
        'gold': '#EAB308',
        'commodity': '#8B5CF6',
        'other': '#6B7280',
    };
    return COLORS[type] || COLORS['other'];
};
