import { useState, useEffect, useMemo } from 'react';
import {
    getTransactions,
    getPortfolio,
    formatCurrency,
    formatPercent,
    getAssetTypeName,
} from '../lib/api';
import type { Transaction, PortfolioResponse } from '../types';
import AnalysisDetail from './AnalysisDetail';

type ViewMode = 'overview' | 'detail_asset' | 'detail_month';

interface DetailState {
    mode: ViewMode;
    id: string; // 'stock', 'crypto' OR '2023-10'
    title: string;
}

export default function AnalysisPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailView, setDetailView] = useState<DetailState | null>(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                setLoading(true);
                setError(null);
                const [txData, portfolioData] = await Promise.all([
                    getTransactions(),
                    getPortfolio(),
                ]);
                setTransactions(txData);
                setPortfolio(portfolioData);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load data');
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const analysis = useMemo(() => {
        if (!transactions.length || !portfolio) return null;

        // Group by asset type
        const byAssetType: Record<string, { value: number; count: number }> = {};
        portfolio.assets.forEach(asset => {
            const type = asset.asset_type;
            if (!byAssetType[type]) {
                byAssetType[type] = { value: 0, count: 0 };
            }
            byAssetType[type].value += asset.current_value;
            byAssetType[type].count += 1;
        });

        // Calculate totals
        const totalValue = Object.values(byAssetType).reduce((sum, item) => sum + item.value, 0);

        // Asset breakdown with percentages
        const assetBreakdown = Object.entries(byAssetType)
            .map(([type, data]) => ({
                type,
                value: data.value,
                count: data.count,
                percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            }))
            .sort((a, b) => b.value - a.value);

        // Monthly activity
        const monthlyData: Record<string, { buys: number; sells: number; count: number }> = {};
        transactions.forEach(tx => {
            const month = tx.timestamp.substring(0, 7);
            if (!monthlyData[month]) {
                monthlyData[month] = { buys: 0, sells: 0, count: 0 };
            }
            const value = tx.quantity * tx.price;
            if (tx.action === 'buy' || tx.action === 'long') {
                monthlyData[month].buys += value;
            } else if (tx.action === 'sell' || tx.action === 'short' || tx.action.includes('close')) {
                monthlyData[month].sells += value;
            }
            monthlyData[month].count += 1;
        });

        const recentMonths = Object.entries(monthlyData)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 6);

        // Top performers
        const topGainers = [...portfolio.assets]
            .filter(a => a.unrealized_pnl_percent > 0)
            .sort((a, b) => b.unrealized_pnl_percent - a.unrealized_pnl_percent)
            .slice(0, 5);

        const topLosers = [...portfolio.assets]
            .filter(a => a.unrealized_pnl_percent < 0)
            .sort((a, b) => a.unrealized_pnl_percent - b.unrealized_pnl_percent)
            .slice(0, 5);

        return {
            assetBreakdown,
            recentMonths,
            topGainers,
            topLosers,
            totalAssets: portfolio.assets.length,
            totalTransactions: transactions.length,
            totalValue,
        };
    }, [transactions, portfolio]);

    // Filter data for detail view
    const detailData = useMemo(() => {
        if (!detailView || !portfolio) return { assets: [], transactions: [] };

        if (detailView.mode === 'detail_asset') {
            return {
                assets: portfolio.assets.filter(a => a.asset_type === detailView.id),
                transactions: []
            };
        } else if (detailView.mode === 'detail_month') {
            return {
                assets: [],
                transactions: transactions.filter(t => t.timestamp.startsWith(detailView.id))
            };
        }
        return { assets: [], transactions: [] };
    }, [detailView, portfolio, transactions]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 text-center">
                <p className="text-red-300 text-sm">{error}</p>
            </div>
        );
    }

    if (!analysis) {
        return (
            <div className="text-center py-8 text-dark-400">
                No data available for analysis
            </div>
        );
    }

    const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            stock: 'bg-blue-500',
            crypto: 'bg-orange-500',
            foreign_stock: 'bg-emerald-500',
            tfex: 'bg-purple-500',
            gold: 'bg-yellow-500',
            commodity: 'bg-amber-600',
        };
        return colors[type] || 'bg-gray-500';
    };



    if (detailView) {
        return (
            <AnalysisDetail
                type={detailView.mode === 'detail_asset' ? 'asset_type' : 'month'}
                title={detailView.title}
                assets={detailData.assets}
                transactions={detailData.transactions}
                onBack={() => setDetailView(null)}
            />
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Analysis</h2>
            </div>

            {/* Overview Stats */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-dark-800 rounded-lg p-3 border border-dark-700 text-center">
                    <div className="text-2xl font-bold text-white">{analysis.totalAssets}</div>
                    <div className="text-xs text-dark-400">Assets</div>
                </div>
                <div className="bg-dark-800 rounded-lg p-3 border border-dark-700 text-center">
                    <div className="text-2xl font-bold text-white">{analysis.totalTransactions}</div>
                    <div className="text-xs text-dark-400">Transactions</div>
                </div>
                <div className="bg-dark-800 rounded-lg p-3 border border-dark-700 text-center">
                    <div className="text-lg font-bold text-primary-400">{formatCurrency(analysis.totalValue, 'THB')}</div>
                    <div className="text-xs text-dark-400">Total Value</div>
                </div>
            </div>

            {/* Asset Type Breakdown */}
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                <h3 className="text-sm font-semibold text-white mb-3">Asset Allocation</h3>
                <div className="space-y-3">
                    {analysis.assetBreakdown.map((item) => (
                        <div
                            key={item.type}
                            className="active:opacity-70 cursor-pointer"
                            onClick={() => setDetailView({
                                mode: 'detail_asset',
                                id: item.type,
                                title: `${getAssetTypeName(item.type as any)} Holdings`
                            })}
                        >
                            <div className="flex items-center justify-between text-sm mb-1">
                                <div className="flex items-center gap-2">
                                    <div className={`w-3 h-3 rounded-full ${getTypeColor(item.type)}`}></div>
                                    <span className="text-white">{getAssetTypeName(item.type as any)}</span>
                                    <span className="text-dark-400">({item.count})</span>
                                </div>
                                <span className="text-dark-300">{item.percentage.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${getTypeColor(item.type)} rounded-full transition-all`}
                                    style={{ width: `${item.percentage}%` }}
                                ></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top Gainers */}
            {analysis.topGainers.length > 0 && (
                <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                    <h3 className="text-sm font-semibold text-green-400 mb-3">🚀 Top Gainers</h3>
                    <div className="space-y-2">
                        {analysis.topGainers.map((asset) => (
                            <div key={asset.symbol} className="flex items-center justify-between">
                                <span className="text-white text-sm">{asset.symbol}</span>
                                <span className="text-green-400 text-sm font-medium">
                                    {formatPercent(asset.unrealized_pnl_percent)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Losers */}
            {analysis.topLosers.length > 0 && (
                <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                    <h3 className="text-sm font-semibold text-red-400 mb-3">📉 Top Losers</h3>
                    <div className="space-y-2">
                        {analysis.topLosers.map((asset) => (
                            <div key={asset.symbol} className="flex items-center justify-between">
                                <span className="text-white text-sm">{asset.symbol}</span>
                                <span className="text-red-400 text-sm font-medium">
                                    {formatPercent(asset.unrealized_pnl_percent)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Monthly Activity */}
            {analysis.recentMonths.length > 0 && (
                <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
                    <h3 className="text-sm font-semibold text-white mb-3">📊 Monthly Activity</h3>
                    <div className="space-y-2">
                        {analysis.recentMonths.map(([month, data]) => (
                            <div
                                key={month}
                                className="flex items-center justify-between text-sm active:bg-dark-700 p-2 -mx-2 rounded-lg cursor-pointer transition-colors"
                                onClick={() => setDetailView({
                                    mode: 'detail_month',
                                    id: month,
                                    title: `Activity: ${month}`
                                })}
                            >
                                <span className="text-dark-300">{month}</span>
                                <div className="flex items-center gap-4">
                                    <span className="text-green-400">+{formatCurrency(data.buys, 'THB')}</span>
                                    <span className="text-red-400">-{formatCurrency(data.sells, 'THB')}</span>
                                    <span className="text-dark-400">({data.count})</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
