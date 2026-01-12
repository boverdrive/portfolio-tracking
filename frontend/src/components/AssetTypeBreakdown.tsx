import React from 'react';
import { formatCurrency, getAssetTypeName } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';

interface AssetData {
    type: string;
    value: number; // This is the "Invested" amount (Cost)
    color: string;
}

interface AssetTypeBreakdownProps {
    data: AssetData[];
    totalValue: number;
    displayCurrency: string;
    onTypeSelect?: (type: string) => void;
}

const COLORS: Record<string, string> = {
    'tfex': '#10B981', // Emerald-500
    'stock': '#3B82F6', // Blue-500
    'crypto': '#F59E0B', // Amber-500
    'crypto_futures': '#EC4899', // Pink-500
    'foreign_stock': '#EF4444', // Red-500
    'gold': '#EAB308', // Yellow-500
    'commodity': '#8B5CF6', // Violet-500
    'other': '#6B7280', // Gray-500
};

export default function AssetTypeBreakdown({ data, totalValue, displayCurrency, onTypeSelect }: AssetTypeBreakdownProps) {
    const { settings } = useSettings();
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    let currentOffset = 0;

    // Filter out zero values and sort by value descending
    const activeData = data.filter(d => d.value > 0).sort((a, b) => b.value - a.value);

    // Calculate segments for SVG
    const segments = activeData.map(item => {
        const percentage = totalValue > 0 ? item.value / totalValue : 0;
        const length = percentage * circumference;
        const offset = currentOffset;
        currentOffset -= length; // Clockwise
        return {
            ...item,
            percentage,
            strokeDasharray: `${length} ${circumference}`,
            strokeDashoffset: offset // SVG coordinate system
        };
    });

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                Asset Type Investment Breakdown
            </h2>

            <div className="flex flex-col md:flex-row items-center gap-8">
                {/* Donut Chart */}
                <div className="relative w-48 h-48 shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        {/* Background Circle */}
                        <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="none"
                            stroke="#374151" // gray-700
                            strokeWidth="12"
                        />
                        {/* Segments */}
                        {segments.map((segment, index) => (
                            <circle
                                key={segment.type}
                                cx="50"
                                cy="50"
                                r={radius}
                                fill="none"
                                stroke={COLORS[segment.type] || COLORS['other']}
                                strokeWidth="12"
                                strokeDasharray={segment.strokeDasharray}
                                strokeDashoffset={segment.strokeDashoffset}
                                className="transition-all duration-500 ease-out hover:opacity-80 cursor-pointer"
                                onClick={() => onTypeSelect?.(segment.type)}
                            />
                        ))}
                    </svg>
                    {/* Center Text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-xs text-gray-400">Total Invested</span>
                        <span className="text-sm font-bold text-white font-mono">
                            {formatCurrency(totalValue, displayCurrency)}
                        </span>
                    </div>
                </div>

                {/* Legend */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {activeData.map((item) => {
                        const percentage = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
                        return (
                            <div
                                key={item.type}
                                className="bg-gray-900/40 rounded-lg p-3 border border-gray-700/30 flex items-center justify-between cursor-pointer hover:bg-gray-800/60 transition-colors"
                                onClick={() => onTypeSelect?.(item.type)}
                            >
                                <div className="flex items-start gap-3">
                                    <div
                                        className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                                        style={{ backgroundColor: COLORS[item.type] || COLORS['other'] }}
                                    />
                                    <div>
                                        <div className="text-sm text-gray-400">
                                            {item.type === 'crypto_futures'
                                                ? (settings.language === 'th' ? 'Crypto (Futures)' : 'Crypto (Futures)')
                                                : getAssetTypeName(item.type as any, settings.language)
                                            }
                                        </div>
                                        <div className="text-xl font-bold text-white">{percentage.toFixed(1)}%</div>
                                        <div className="text-xs text-gray-500 font-mono mt-1">
                                            {formatCurrency(item.value, displayCurrency)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
