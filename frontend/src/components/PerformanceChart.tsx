'use client';

import { useState, useEffect, useMemo } from 'react';
import { getSnapshots, PortfolioSnapshot, formatCurrency, DisplayCurrency } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';

type Timeframe = '7D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

interface Props {
    displayCurrency?: DisplayCurrency;
    className?: string;
}

export default function PerformanceChart({ displayCurrency = 'THB', className = '' }: Props) {
    const { t } = useSettings();
    const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [timeframe, setTimeframe] = useState<Timeframe>('1M');
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const timeframeDays: Record<Timeframe, number | undefined> = {
        '7D': 7,
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365,
        'ALL': undefined,
    };

    useEffect(() => {
        const fetchSnapshots = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const days = timeframeDays[timeframe];
                const data = await getSnapshots(days);
                setSnapshots(data);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load data');
            } finally {
                setIsLoading(false);
            }
        };
        fetchSnapshots();
    }, [timeframe]);

    // Calculate chart data
    const chartData = useMemo(() => {
        if (snapshots.length === 0) return { points: [], min: 0, max: 0, change: 0, changePercent: 0 };

        const points = snapshots.map(s => ({
            date: s.date,
            value: s.total_current_value,
            pnl: s.total_unrealized_pnl,
            pnlPercent: s.total_unrealized_pnl_percent,
        }));

        const values = points.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);

        const firstValue = points[0]?.value || 0;
        const lastValue = points[points.length - 1]?.value || 0;
        const change = lastValue - firstValue;
        const changePercent = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

        return { points, min, max, change, changePercent };
    }, [snapshots]);

    // Generate SVG path
    const svgPath = useMemo(() => {
        if (chartData.points.length < 2) return '';

        const width = 100;
        const height = 100;
        const padding = 5;
        const range = chartData.max - chartData.min || 1;

        const points = chartData.points.map((p, i) => {
            const x = padding + (i / (chartData.points.length - 1)) * (width - padding * 2);
            const y = height - padding - ((p.value - chartData.min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });

        return `M ${points.join(' L ')}`;
    }, [chartData]);

    // Generate area path for gradient fill
    const areaPath = useMemo(() => {
        if (chartData.points.length < 2) return '';

        const width = 100;
        const height = 100;
        const padding = 5;
        const range = chartData.max - chartData.min || 1;

        const points = chartData.points.map((p, i) => {
            const x = padding + (i / (chartData.points.length - 1)) * (width - padding * 2);
            const y = height - padding - ((p.value - chartData.min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });

        return `M ${padding},${height - padding} L ${points.join(' L ')} L ${100 - padding},${height - padding} Z`;
    }, [chartData]);

    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        } catch {
            return dateString;
        }
    };

    const isPositive = chartData.change >= 0;

    if (isLoading) {
        return (
            <div className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 ${className}`}>
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
                    <div className="h-48 bg-gray-700/50 rounded"></div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 ${className}`}>
                <div className="text-center text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm">{error}</p>
                </div>
            </div>
        );
    }

    if (snapshots.length === 0) {
        return (
            <div className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 ${className}`}>
                <div className="text-center text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p className="text-sm">{t('ยังไม่มีข้อมูลประวัติ', 'No historical data yet')}</p>
                    <p className="text-xs text-gray-600 mt-1">{t('ข้อมูลจะถูกบันทึกอัตโนมัติทุกวัน', 'Data will be recorded daily')}</p>
                </div>
            </div>
        );
    }

    // Helper to safely calculate x position (avoid division by zero)
    const getXPosition = (index: number, total: number): number => {
        if (total <= 1) return 50; // Center if only 1 point
        return 5 + (index / (total - 1)) * 90;
    };

    return (
        <div className={`bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden ${className}`}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        📈 {t('ประวัติมูลค่าพอร์ต', 'Portfolio History')}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`text-2xl font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isPositive ? '+' : ''}{formatCurrency(chartData.change, displayCurrency)}
                        </span>
                        <span className={`text-sm px-2 py-0.5 rounded ${isPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {isPositive ? '▲' : '▼'} {Math.abs(chartData.changePercent).toFixed(2)}%
                        </span>
                    </div>
                </div>

                {/* Timeframe Selector */}
                <div className="flex gap-1 bg-gray-900/50 rounded-lg p-1">
                    {(['7D', '1M', '3M', '6M', '1Y', 'ALL'] as Timeframe[]).map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${timeframe === tf
                                ? 'bg-emerald-500 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                                }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div className="p-6">
                <div className="relative h-64">
                    <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="w-full h-full"
                        onMouseLeave={() => setHoveredIndex(null)}
                    >
                        {/* Gradient Definition */}
                        <defs>
                            <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity="0.3" />
                                <stop offset="100%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Area fill */}
                        <path
                            d={areaPath}
                            fill="url(#chartGradient)"
                        />

                        {/* Line */}
                        <path
                            d={svgPath}
                            fill="none"
                            stroke={isPositive ? '#10b981' : '#f43f5e'}
                            strokeWidth="0.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />

                        {/* Interactive hover points */}
                        {chartData.points.map((point, i) => {
                            const x = getXPosition(i, chartData.points.length);
                            const range = chartData.max - chartData.min || 1;
                            const y = 100 - 5 - ((point.value - chartData.min) / range) * 90;

                            return (
                                <g key={i}>
                                    <rect
                                        x={x - 1}
                                        y={0}
                                        width={2}
                                        height={100}
                                        fill="transparent"
                                        onMouseEnter={() => setHoveredIndex(i)}
                                    />
                                    {hoveredIndex === i && (
                                        <>
                                            <line
                                                x1={x}
                                                y1={0}
                                                x2={x}
                                                y2={100}
                                                stroke="#6b7280"
                                                strokeWidth="0.2"
                                                strokeDasharray="2,2"
                                            />
                                            <circle
                                                cx={x}
                                                cy={y}
                                                r="1.5"
                                                fill={isPositive ? '#10b981' : '#f43f5e'}
                                                stroke="white"
                                                strokeWidth="0.3"
                                            />
                                        </>
                                    )}
                                </g>
                            );
                        })}
                    </svg>

                    {/* Tooltip */}
                    {hoveredIndex !== null && chartData.points[hoveredIndex] && (
                        <div
                            className="absolute bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-xl pointer-events-none z-10"
                            style={{
                                left: `${chartData.points.length <= 1 ? 50 : (hoveredIndex / (chartData.points.length - 1)) * 100}%`,
                                top: '10px',
                                transform: 'translateX(-50%)',
                            }}
                        >
                            <div className="text-gray-400 text-xs">{formatDate(chartData.points[hoveredIndex].date)}</div>
                            <div className="text-white font-semibold">
                                {formatCurrency(chartData.points[hoveredIndex].value, displayCurrency)}
                            </div>
                            <div className={`text-xs ${chartData.points[hoveredIndex].pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {chartData.points[hoveredIndex].pnl >= 0 ? '+' : ''}
                                {formatCurrency(chartData.points[hoveredIndex].pnl, displayCurrency)}
                                {' '}({chartData.points[hoveredIndex].pnlPercent.toFixed(2)}%)
                            </div>
                        </div>
                    )}
                </div>

                {/* X-axis labels */}
                <div className="flex justify-between text-xs text-gray-500 mt-2 px-1">
                    {chartData.points.length > 0 && (
                        <>
                            <span>{formatDate(chartData.points[0].date)}</span>
                            {chartData.points.length > 2 && (
                                <span>{formatDate(chartData.points[Math.floor(chartData.points.length / 2)].date)}</span>
                            )}
                            <span>{formatDate(chartData.points[chartData.points.length - 1].date)}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Footer stats */}
            <div className="px-6 py-3 bg-gray-900/30 border-t border-gray-700/50 grid grid-cols-3 gap-4 text-center">
                <div>
                    <div className="text-xs text-gray-500">{t('สูงสุด', 'Highest')}</div>
                    <div className="text-sm font-semibold text-white">{formatCurrency(chartData.max, displayCurrency)}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">{t('ต่ำสุด', 'Lowest')}</div>
                    <div className="text-sm font-semibold text-white">{formatCurrency(chartData.min, displayCurrency)}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">{t('จุดข้อมูล', 'Data Points')}</div>
                    <div className="text-sm font-semibold text-white">{chartData.points.length}</div>
                </div>
            </div>
        </div>
    );
}
