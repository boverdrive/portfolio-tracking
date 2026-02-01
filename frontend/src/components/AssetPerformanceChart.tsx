'use client';

import { useState, useEffect, useMemo } from 'react';
import { getPriceHistory, HistoryEntry, formatCurrency, DisplayCurrency } from '@/lib/api';
import { PortfolioAsset } from '@/types';
import { useSettings } from '@/contexts/SettingsContext';


type Timeframe = '7D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

interface Props {
    asset: PortfolioAsset;
    displayCurrency: DisplayCurrency;
    className?: string;
    onClose?: () => void;
}

export default function AssetPerformanceChart({ asset, displayCurrency = 'THB', className = '', onClose }: Props) {
    const { t } = useSettings();
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [timeframe, setTimeframe] = useState<Timeframe>('1M');
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const timeframeDays: Record<Timeframe, number> = {
        '7D': 7,
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365,
        'ALL': 730, // 2 years
    };

    useEffect(() => {
        const fetchHistory = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const days = timeframeDays[timeframe];
                const data = await getPriceHistory(asset.symbol, asset.asset_type, asset.market, days);
                setHistory(data);
            } catch (err) {
                console.error('Failed to load history:', err);
                setError(t('ไม่พบข้อมูลประวัติราคา', 'History data not found'));
            } finally {
                setIsLoading(false);
            }
        };
        fetchHistory();
    }, [asset.symbol, asset.asset_type, asset.market, timeframe]);

    // Calculate chart data
    const chartData = useMemo(() => {
        if (history.length === 0) return { points: [], min: 0, max: 0, avgCost: asset.avg_cost };

        const points = history.map(h => ({
            date: h.date,
            value: h.price,
            avgCost: asset.avg_cost
        }));

        const values = points.map(p => p.value);
        // Include avgCost in min/max to ensure it's visible
        values.push(asset.avg_cost);

        let min = Math.min(...values);
        let max = Math.max(...values);

        // Add padding
        const range = max - min || 1;
        min = Math.max(0, min - range * 0.1);
        max = max + range * 0.1;

        return { points, min, max, avgCost: asset.avg_cost };
    }, [history, asset.avg_cost]);

    // Generate SVG path for Price Line
    const pricePath = useMemo(() => {
        if (chartData.points.length < 2) return '';

        const width = 100;
        const height = 100;
        const padding = 5; // Reduced vertical padding as we already padded min/max
        const range = chartData.max - chartData.min || 1;

        const points = chartData.points.map((p, i) => {
            const x = (i / (chartData.points.length - 1)) * 100;
            const y = 100 - ((p.value - chartData.min) / range) * 100;
            return `${x},${y}`;
        });

        return `M ${points.join(' L ')}`;
    }, [chartData]);

    // Generate path for Average Cost Line
    const avgCostPath = useMemo(() => {
        const range = chartData.max - chartData.min || 1;
        const y = 100 - ((chartData.avgCost - chartData.min) / range) * 100;
        return `M 0,${y} L 100,${y}`;
    }, [chartData]);

    // Format date helper
    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        } catch {
            return dateString;
        }
    };

    const isProfit = (price: number) => price >= asset.avg_cost;

    return (
        <div className={`bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-md rounded-xl border border-gray-700/50 overflow-hidden shadow-2xl ${className}`}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full hover:bg-gray-700/50 text-gray-400 transition-colors"
                        title={t('ปิด', 'Close')}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            {asset.symbol} <span className="text-gray-400 text-sm font-normal">{t('Performance', 'Performance')}</span>
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                            {t('ทุนเฉลี่ย', 'Avg Cost')}: <span className="text-white font-mono">{formatCurrency(asset.avg_cost, asset.currency)}</span>
                        </div>
                    </div>
                </div>

                {/* Timeframe Selector */}
                <div className="flex gap-1 bg-gray-900/50 rounded-lg p-1">
                    {(['7D', '1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${timeframe === tf
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                                }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart Area */}
            <div className="p-6 relative h-[300px] w-full">
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                        <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p>{error}</p>
                    </div>
                ) : (
                    <div className="relative w-full h-full">
                        <svg
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            className="w-full h-full overflow-visible"
                            onMouseLeave={() => setHoveredIndex(null)}
                        >
                            {/* Avg Cost Line */}
                            <path
                                d={avgCostPath}
                                fill="none"
                                stroke="#9ca3af" // gray-400
                                strokeWidth="0.5"
                                strokeDasharray="2,1"
                            />

                            {/* Price Line */}
                            <path
                                d={pricePath}
                                fill="none"
                                stroke="#818cf8" // indigo-400
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                            />

                            {/* Interactive Zone */}
                            {chartData.points.map((_, i) => (
                                <rect
                                    key={i}
                                    x={(i / (chartData.points.length - 1)) * 100 - 0.5}
                                    y={0}
                                    width={100 / chartData.points.length}
                                    height={100}
                                    fill="transparent"
                                    onMouseEnter={() => setHoveredIndex(i)}
                                />
                            ))}
                        </svg>

                        {/* Hover Tooltip/Indicator */}
                        {hoveredIndex !== null && chartData.points[hoveredIndex] && (
                            <>
                                {(() => {
                                    const point = chartData.points[hoveredIndex];
                                    const xPct = (hoveredIndex / (chartData.points.length - 1)) * 100;
                                    const range = chartData.max - chartData.min || 1;
                                    const yPct = 100 - ((point.value - chartData.min) / range) * 100;

                                    const isAboveCost = point.value >= asset.avg_cost;
                                    const pnlPct = ((point.value - asset.avg_cost) / asset.avg_cost) * 100;

                                    return (
                                        <>
                                            {/* Vertical Line */}
                                            <div
                                                className="absolute top-0 bottom-0 border-l border-white/20 pointer-events-none"
                                                style={{ left: `${xPct}%` }}
                                            />

                                            {/* Dot */}
                                            <div
                                                className={`absolute w-3 h-3 rounded-full border-2 border-white shadow-lg pointer-events-none ${isAboveCost ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                                style={{
                                                    left: `${xPct}%`,
                                                    top: `${yPct}%`,
                                                    transform: 'translate(-50%, -50%)'
                                                }}
                                            />

                                            {/* Tooltip */}
                                            <div
                                                className="absolute z-20 bg-gray-900/90 border border-gray-700 text-xs rounded-lg p-2 shadow-xl whitespace-nowrap pointer-events-none"
                                                style={{
                                                    left: `${xPct < 50 ? xPct + 2 : xPct - 2}%`,
                                                    top: '10px',
                                                    transform: xPct < 50 ? 'none' : 'translateX(-100%)'
                                                }}
                                            >
                                                <div className="text-gray-400 mb-1">{formatDate(point.date)}</div>
                                                <div className="font-bold text-white text-sm mb-0.5">
                                                    {formatCurrency(point.value, asset.currency)}
                                                </div>
                                                <div className={`${isAboveCost ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {isAboveCost ? '+' : ''}{pnlPct.toFixed(2)}% vs Cost
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Stats */}
            {!isLoading && !error && (
                <div className="px-6 py-3 bg-gray-900/40 border-t border-gray-700/50 flex justify-between text-xs text-gray-400">
                    <div>
                        Low: <span className="text-white">{formatCurrency(chartData.min + (chartData.max - chartData.min) * 0.1 /* Un-pad */, asset.currency)}</span>
                    </div>
                    <div>
                        High: <span className="text-white">{formatCurrency(chartData.max - (chartData.max - chartData.min) * 0.1 /* Un-pad */, asset.currency)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
