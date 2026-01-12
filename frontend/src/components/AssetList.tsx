'use client';

import { useState, useMemo } from 'react';
import { PortfolioAsset, PortfolioResponse } from '@/types';
import { formatCurrency, formatPercent, formatNumber, getAssetTypeName, getMarketName, DisplayCurrency } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';
import AssetLogo from '@/components/AssetLogo';
import AssetDetailsModal from '@/components/AssetDetailsModal';

interface Props {
    assets: PortfolioAsset[];
    portfolio?: PortfolioResponse | null;
    isLoading?: boolean;
    displayCurrency?: DisplayCurrency;
    convertToDisplayCurrency?: (value: number, fromCurrency?: string) => number;
    onAssetSelect?: (asset: PortfolioAsset) => void;
}

type SortColumn = 'symbol' | 'quantity' | 'avg_cost' | 'current_price' | 'current_value' | 'pnl';
type SortDirection = 'asc' | 'desc';

export default function AssetList({ assets, portfolio, isLoading, displayCurrency = 'THB', convertToDisplayCurrency, onAssetSelect }: Props) {
    const { t, settings } = useSettings();
    const [sortColumn, setSortColumn] = useState<SortColumn>('symbol');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    const formatValue = (value: number) => {
        if (displayCurrency === 'BTC') {
            return `₿ ${value.toFixed(8)}`;
        }
        return formatCurrency(value, displayCurrency);
    };

    // Sort handler
    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Sorted assets
    const sortedAssets = useMemo(() => {
        return [...assets].sort((a, b) => {
            let aVal: string | number = '';
            let bVal: string | number = '';

            switch (sortColumn) {
                case 'symbol':
                    aVal = a.symbol.toLowerCase();
                    bVal = b.symbol.toLowerCase();
                    break;
                case 'quantity':
                    aVal = a.quantity;
                    bVal = b.quantity;
                    break;
                case 'avg_cost':
                    aVal = a.avg_cost;
                    bVal = b.avg_cost;
                    break;
                case 'current_price':
                    aVal = a.current_price;
                    bVal = b.current_price;
                    break;
                case 'current_value':
                    aVal = a.current_value;
                    bVal = b.current_value;
                    break;
                case 'pnl':
                    aVal = a.unrealized_pnl;
                    bVal = b.unrealized_pnl;
                    break;
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [assets, sortColumn, sortDirection]);

    // Sortable header component
    const SortableHeader = ({ column, label, className }: { column: SortColumn; label: string; className?: string }) => (
        <div
            className={`cursor-pointer hover:text-white transition-colors select-none flex items-center gap-1 ${className || ''}`}
            onClick={() => handleSort(column)}
        >
            <span>{label}</span>
            {sortColumn === column && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    {sortDirection === 'asc' ? (
                        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                    ) : (
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    )}
                </svg>
            )}
        </div>
    );

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
                <SortableHeader column="symbol" label={t('สินทรัพย์', 'Asset')} className="flex-1" />
                <SortableHeader column="quantity" label={t('จำนวน', 'Quantity')} className="flex-1 justify-end" />
                <SortableHeader column="avg_cost" label={t('ต้นทุนเฉลี่ย', 'Avg Cost')} className="flex-1 justify-end" />
                <SortableHeader column="current_price" label={t('ราคาปัจจุบัน', 'Price')} className="flex-1 justify-end" />
                <SortableHeader column="current_value" label={t('มูลค่าปัจจุบัน', 'Value')} className="flex-1 justify-end" />
                <SortableHeader column="pnl" label={t('กำไร/ขาดทุน', 'P & L')} className="flex-1 justify-end" />
            </div>

            {/* Asset rows */}
            <div className="divide-y divide-gray-700/50">
                {sortedAssets.map((asset, index) => {
                    const pnlColor = asset.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
                    const bgHover = asset.unrealized_pnl >= 0
                        ? 'hover:bg-emerald-500/5'
                        : 'hover:bg-rose-500/5';
                    const isClosed = Math.abs(asset.quantity) < 0.00000001;
                    const closedOpacity = isClosed ? 'opacity-60' : '';

                    return (
                        <div
                            key={`${asset.asset_type}-${asset.market || ''}-${asset.symbol}-${asset.position_type || 'spot'}`}
                            className={`flex px-6 py-4 items-center transition-colors cursor-pointer ${bgHover} ${closedOpacity}`}
                            style={{ animationDelay: `${index * 50}ms` }}
                            onClick={() => onAssetSelect?.(asset)}
                        >
                            {/* Symbol */}
                            <div className="flex-1 flex items-center gap-3">
                                <AssetLogo symbol={asset.symbol} assetType={asset.asset_type} size="md" />
                                <div>
                                    <div className="font-semibold text-white flex items-center gap-2">
                                        {asset.symbol}

                                        {/* Position Type Badges */}
                                        {asset.position_type === 'long' && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded uppercase font-medium">
                                                Long {asset.leverage && asset.leverage > 1 ? `${asset.leverage}x` : ''}
                                            </span>
                                        )}
                                        {asset.position_type === 'short' && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded uppercase font-medium">
                                                Short {asset.leverage && asset.leverage > 1 ? `${asset.leverage}x` : ''}
                                            </span>
                                        )}

                                        {isClosed && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-600 text-gray-300 rounded uppercase font-medium">
                                                {t('ขายแล้ว', 'Closed')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 flex items-center gap-2">
                                        <span>{getAssetTypeName(asset.asset_type, settings.language)}</span>
                                        {asset.market && <span>• {getMarketName(asset.market, settings.language).split(' ')[0]}</span>}
                                    </div>

                                </div>
                            </div>

                            {/* Quantity */}
                            <div className="flex-1 text-right font-mono text-gray-300">
                                {formatNumber(asset.quantity, asset.asset_type === 'crypto' ? 8 : 2)}
                            </div>

                            {/* Average Cost + Fees */}
                            <div className="flex-1 text-right">
                                <div className="font-mono text-gray-300 whitespace-nowrap">{formatValue(asset.avg_cost)}</div>
                                {asset.total_fees > 0 && (
                                    <div className="text-xs text-gray-500">
                                        {t('ค่าธรรมเนียม', 'Fees')}: {formatValue(asset.total_fees)}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 text-right">
                                <div className="font-mono text-white flex items-center justify-end gap-1 whitespace-nowrap">
                                    {formatValue(asset.current_price)}
                                    <span className={`text-xs ${pnlColor}`}>
                                        {asset.current_price > asset.avg_cost ? '▲' : asset.current_price < asset.avg_cost ? '▼' : '—'}
                                    </span>
                                </div>
                            </div>

                            {/* Current Value */}
                            <div className="flex-1 text-right font-mono text-white">
                                {formatValue(asset.current_value)}
                            </div>

                            {/* P&L */}
                            <div className="flex-1 text-right">
                                {(() => {
                                    const netPnl = asset.unrealized_pnl + asset.realized_pnl;
                                    const hasRealized = Math.abs(asset.realized_pnl) > 0.00000001;
                                    const isPositive = netPnl >= 0;
                                    const valueColor = isPositive ? 'text-emerald-400' : 'text-rose-400';

                                    return (
                                        <>
                                            <div className={`font-semibold ${valueColor}`}>
                                                {formatValue(netPnl)}
                                            </div>
                                            {isClosed ? (
                                                <div className="text-xs text-gray-500">
                                                    {t('กำไรที่รับรู้', 'Realized')}
                                                </div>
                                            ) : (
                                                <div className={`text-sm ${asset.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {formatPercent(asset.unrealized_pnl_percent)}
                                                    {hasRealized && (
                                                        <span className="text-gray-500 text-xs ml-1" title={t('รวมกำไรที่รับรู้แล้ว', 'Includes Realized')}>
                                                            (Net)
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

