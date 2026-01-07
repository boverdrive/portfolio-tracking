'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Header from '@/components/Header';
import { useSettings } from '@/contexts/SettingsContext';
import { getTransactions, getPortfolio, getAccounts, formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, getAllExchangeRates } from '@/lib/api';
import { Transaction, PortfolioResponse, Account } from '@/types';

export default function AnalysisPage() {
    const { t, settings } = useSettings();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Currency state
    const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('THB');
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [isLoadingRates, setIsLoadingRates] = useState(false);

    const currencyOptions = [
        { value: 'THB' as DisplayCurrency, icon: '🇹🇭' },
        { value: 'USD' as DisplayCurrency, icon: '🇺🇸' },
        { value: 'BTC' as DisplayCurrency, icon: '₿' },
    ];

    // Load data
    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                const [txData, portfolioData, accountsData] = await Promise.all([
                    getTransactions(),
                    getPortfolio(),
                    getAccounts(),
                ]);
                setTransactions(txData);
                setPortfolio(portfolioData);
                setAccounts(accountsData);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    // Fetch exchange rates
    useEffect(() => {
        const fetchRates = async () => {
            setIsLoadingRates(true);
            try {
                const rates = await getAllExchangeRates('THB');
                setExchangeRates(rates.rates);
            } catch (err) {
                console.error('Failed to fetch exchange rates:', err);
            } finally {
                setIsLoadingRates(false);
            }
        };
        fetchRates();
    }, []);

    // Convert value to display currency
    const convertToDisplayCurrency = useCallback((value: number, fromCurrency: string = 'THB'): number => {
        if (displayCurrency === fromCurrency) return value;

        let valueInThb = value;
        if (fromCurrency !== 'THB' && exchangeRates[fromCurrency]) {
            valueInThb = value / exchangeRates[fromCurrency];
        }

        if (displayCurrency === 'THB') return valueInThb;

        const rate = exchangeRates[displayCurrency];
        if (!rate) return valueInThb;

        return valueInThb * rate;
    }, [displayCurrency, exchangeRates]);

    // Helper functions for action types
    const isOpenAction = (action: string) => action === 'buy' || action === 'long';
    const isCloseAction = (action: string) => action === 'sell' || action === 'short' || action === 'close_long' || action === 'close_short';

    // Analysis calculations
    const analysis = useMemo(() => {
        if (!transactions.length) return null;

        // Group transactions by symbol
        const bySymbol: Record<string, { buys: number; sells: number; quantity: number; avgBuyPrice: number; totalBuyQty: number }> = {};

        transactions.forEach(tx => {
            if (!bySymbol[tx.symbol]) {
                bySymbol[tx.symbol] = { buys: 0, sells: 0, quantity: 0, avgBuyPrice: 0, totalBuyQty: 0 };
            }
            const value = tx.quantity * tx.price * (tx.leverage || 1);
            if (isOpenAction(tx.action)) {
                bySymbol[tx.symbol].buys += value;
                bySymbol[tx.symbol].quantity += tx.quantity;
                bySymbol[tx.symbol].totalBuyQty += tx.quantity;
            } else if (tx.action === 'short') {
                // Short opens a negative position
                bySymbol[tx.symbol].sells += value;
                bySymbol[tx.symbol].quantity -= tx.quantity;
            } else {
                // sell, close_long, close_short
                bySymbol[tx.symbol].sells += value;
                bySymbol[tx.symbol].quantity -= tx.quantity;
            }
        });

        // Calculate average buy price
        Object.keys(bySymbol).forEach(symbol => {
            if (bySymbol[symbol].totalBuyQty > 0) {
                bySymbol[symbol].avgBuyPrice = bySymbol[symbol].buys / bySymbol[symbol].totalBuyQty;
            }
        });

        // Top performers (by profit/loss if we have current prices)
        const symbolStats = Object.entries(bySymbol).map(([symbol, data]) => {
            const asset = portfolio?.assets.find(a => a.symbol === symbol);
            const currentValue = asset ? asset.current_price * data.quantity : 0;
            const unrealizedPnL = currentValue - (data.buys - data.sells);

            // Calculate cost basis for PnL %
            // For Long: cost is buys
            // For Short: cost is approx. proceeds from sells (initial short value)
            let costBasis = data.buys;
            if (costBasis === 0 && data.quantity < 0) {
                costBasis = data.sells;
            }

            const pnlPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

            return {
                symbol,
                ...data,
                currentValue,
                unrealizedPnL,
                pnlPercent,
                assetType: asset?.asset_type || transactions.find(t => t.symbol === symbol)?.asset_type || 'stock'
            };
        }).filter(s => s.quantity !== 0 || s.sells > 0 || s.buys > 0);

        // Sort by various metrics
        const topGainers = [...symbolStats]
            .filter(s => s.pnlPercent > 0)
            .sort((a, b) => b.pnlPercent - a.pnlPercent)
            .slice(0, 5);

        const topLosers = [...symbolStats]
            .filter(s => s.pnlPercent < 0)
            .sort((a, b) => a.pnlPercent - b.pnlPercent)
            .slice(0, 5);

        const largestPositions = [...symbolStats].sort((a, b) => Math.abs(b.currentValue) - Math.abs(a.currentValue)).slice(0, 5);

        // Monthly activity
        const monthlyData: Record<string, { buys: number; sells: number; count: number }> = {};
        transactions.forEach(tx => {
            const month = tx.timestamp.substring(0, 7); // YYYY-MM
            if (!monthlyData[month]) {
                monthlyData[month] = { buys: 0, sells: 0, count: 0 };
            }
            const value = tx.quantity * tx.price * (tx.leverage || 1);
            if (isOpenAction(tx.action)) {
                monthlyData[month].buys += value;
            } else {
                monthlyData[month].sells += value;
            }
            monthlyData[month].count += 1;
        });

        const recentMonths = Object.entries(monthlyData)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 6)
            .reverse();

        // Monthly Purchase Performance - track purchases by month with current value
        const monthlyPurchasePerf: Record<string, {
            totalInvested: number;
            currentValue: number;
            purchases: { symbol: string; qty: number; cost: number; currentValue: number }[]
        }> = {};

        transactions.filter(tx => isOpenAction(tx.action)).forEach(tx => {
            const month = tx.timestamp.substring(0, 7);
            if (!monthlyPurchasePerf[month]) {
                monthlyPurchasePerf[month] = { totalInvested: 0, currentValue: 0, purchases: [] };
            }
            const cost = tx.quantity * tx.price + tx.fees;
            const asset = portfolio?.assets.find(a => a.symbol === tx.symbol);
            const currValue = asset ? tx.quantity * asset.current_price : cost;

            monthlyPurchasePerf[month].totalInvested += cost;
            monthlyPurchasePerf[month].currentValue += currValue;
            monthlyPurchasePerf[month].purchases.push({
                symbol: tx.symbol,
                qty: tx.quantity,
                cost,
                currentValue: currValue
            });
        });

        const monthlyPerformance = Object.entries(monthlyPurchasePerf)
            .map(([month, data]) => ({
                month,
                totalInvested: data.totalInvested,
                currentValue: data.currentValue,
                pnl: data.currentValue - data.totalInvested,
                pnlPercent: data.totalInvested > 0 ? ((data.currentValue - data.totalInvested) / data.totalInvested) * 100 : 0,
                purchaseCount: data.purchases.length
            }))
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12);

        // Asset type breakdown
        const byAssetType: Record<string, number> = {};
        portfolio?.assets.forEach(asset => {
            const type = asset.asset_type;
            const value = asset.current_price * asset.quantity;
            byAssetType[type] = (byAssetType[type] || 0) + value;
        });

        return {
            topGainers,
            topLosers,
            largestPositions,
            recentMonths,
            monthlyPerformance,
            byAssetType,
            totalAssets: portfolio?.assets.length || 0,
            totalTransactions: transactions.length
        };
    }, [transactions, portfolio]);

    // Account Analysis - breakdown by account with spot/futures separation
    const accountAnalysis = useMemo(() => {
        if (!accounts.length || !transactions.length) return [];

        return accounts.map(account => {
            const accountTxs = transactions.filter(tx => tx.account_id === account.id);
            if (accountTxs.length === 0) {
                return {
                    account,
                    spotValue: 0,
                    spotUnrealizedPnL: 0,
                    spotCostBasis: 0,
                    futuresRealizedPnL: 0,
                    futuresUnrealizedPnL: 0,
                    totalValue: 0,
                    totalPnL: 0,
                    goalProgress: 0,
                };
            }

            // Separate spot and futures
            const spotTxs = accountTxs.filter(tx => tx.asset_type !== 'tfex');
            const futuresTxs = accountTxs.filter(tx => tx.asset_type === 'tfex');

            // ========== SPOT ASSETS ==========
            const spotHoldings = new Map<string, { quantity: number; costBasis: number }>();

            spotTxs.forEach(tx => {
                const current = spotHoldings.get(tx.symbol) || { quantity: 0, costBasis: 0 };
                if (tx.action === 'buy') {
                    current.quantity += tx.quantity;
                    current.costBasis += tx.quantity * tx.price + tx.fees;
                } else if (tx.action === 'sell') {
                    // Reduce holdings proportionally
                    if (current.quantity > 0) {
                        const soldRatio = Math.min(tx.quantity / current.quantity, 1);
                        current.costBasis *= (1 - soldRatio);
                    }
                    current.quantity -= tx.quantity;
                }
                spotHoldings.set(tx.symbol, current);
            });

            let spotValue = 0;
            let spotCostBasis = 0;

            spotHoldings.forEach((holding, symbol) => {
                if (holding.quantity <= 0) return;

                const asset = portfolio?.assets?.find(a => a.symbol === symbol);
                if (asset && asset.current_price > 0) {
                    // Calculate value in asset's native currency
                    let valueInAssetCurrency = holding.quantity * asset.current_price;

                    // Convert to THB if needed  
                    let assetCurrency = asset.currency || 'THB';
                    // Fallback: treat USDT as USD if not available
                    if (assetCurrency === 'USDT' && !exchangeRates['USDT']) {
                        assetCurrency = 'USD';
                    }
                    if (assetCurrency !== 'THB' && exchangeRates[assetCurrency]) {
                        valueInAssetCurrency = valueInAssetCurrency / exchangeRates[assetCurrency];
                    }

                    spotValue += valueInAssetCurrency;
                } else {
                    spotValue += holding.costBasis; // fallback
                }
                spotCostBasis += holding.costBasis;
            });

            const spotUnrealizedPnL = spotValue - spotCostBasis;

            // ========== FUTURES (TFEX) ==========
            let futuresRealizedPnL = 0;
            let futuresUnrealizedPnL = 0;

            const futuresBySymbol = new Map<string, typeof futuresTxs>();
            futuresTxs.forEach(tx => {
                const list = futuresBySymbol.get(tx.symbol) || [];
                list.push(tx);
                futuresBySymbol.set(tx.symbol, list);
            });

            futuresBySymbol.forEach((txs, symbol) => {
                txs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                let longQueue: { quantity: number; price: number; leverage: number }[] = [];
                let shortQueue: { quantity: number; price: number; leverage: number }[] = [];

                txs.forEach(tx => {
                    const leverage = tx.leverage || 1;

                    if (tx.action === 'long') {
                        longQueue.push({ quantity: tx.quantity, price: tx.price, leverage });
                    } else if (tx.action === 'close_long') {
                        let remaining = tx.quantity;
                        while (remaining > 0 && longQueue.length > 0) {
                            const entry = longQueue[0];
                            const matched = Math.min(remaining, entry.quantity);
                            const pnl = (tx.price - entry.price) * matched * entry.leverage;
                            futuresRealizedPnL += pnl;
                            remaining -= matched;
                            entry.quantity -= matched;
                            if (entry.quantity <= 0) longQueue.shift();
                        }
                    } else if (tx.action === 'short') {
                        shortQueue.push({ quantity: tx.quantity, price: tx.price, leverage });
                    } else if (tx.action === 'close_short') {
                        let remaining = tx.quantity;
                        while (remaining > 0 && shortQueue.length > 0) {
                            const entry = shortQueue[0];
                            const matched = Math.min(remaining, entry.quantity);
                            const pnl = (entry.price - tx.price) * matched * entry.leverage;
                            futuresRealizedPnL += pnl;
                            remaining -= matched;
                            entry.quantity -= matched;
                            if (entry.quantity <= 0) shortQueue.shift();
                        }
                    }
                });

                // Calculate unrealized P&L for open positions
                const asset = portfolio?.assets?.find(a => a.symbol === symbol);
                const currentPrice = asset?.current_price || 0;

                longQueue.forEach(pos => {
                    if (currentPrice > 0) {
                        futuresUnrealizedPnL += (currentPrice - pos.price) * pos.quantity * pos.leverage;
                    }
                });

                shortQueue.forEach(pos => {
                    if (currentPrice > 0) {
                        futuresUnrealizedPnL += (pos.price - currentPrice) * pos.quantity * pos.leverage;
                    }
                });
            });

            const totalValue = spotValue + futuresRealizedPnL + futuresUnrealizedPnL;
            const totalPnL = spotUnrealizedPnL + futuresRealizedPnL + futuresUnrealizedPnL;
            const goalProgress = account.target_value && account.target_value > 0
                ? (totalValue / account.target_value) * 100
                : 0;

            return {
                account,
                spotValue,
                spotUnrealizedPnL,
                spotCostBasis,
                futuresRealizedPnL,
                futuresUnrealizedPnL,
                totalValue,
                totalPnL,
                goalProgress,
            };
        }).filter(a => a.spotValue !== 0 || a.futuresRealizedPnL !== 0 || a.futuresUnrealizedPnL !== 0 || a.account.target_value);
    }, [accounts, transactions, portfolio]);

    if (isLoading || isLoadingRates) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Top Navigation Bar */}
            <Header
                currentPage="analysis"
                showCurrencySelector={true}
                currencyValue={displayCurrency}
                onCurrencyChange={(val) => setDisplayCurrency(val as DisplayCurrency)}
                currencyOptions={currencyOptions}
            />

            {/* Main Content */}
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {/* Overview Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/30 p-4">
                        <div className="text-blue-400 text-sm">{t('สินทรัพย์ทั้งหมด', 'Total Assets')}</div>
                        <div className="text-2xl font-bold text-white">{analysis?.totalAssets || 0}</div>
                    </div>
                    <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/30 p-4">
                        <div className="text-emerald-400 text-sm">{t('รายการทั้งหมด', 'Total Transactions')}</div>
                        <div className="text-2xl font-bold text-white">{analysis?.totalTransactions || 0}</div>
                    </div>
                    <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/30 p-4">
                        <div className="text-purple-400 text-sm">{t('มูลค่าพอร์ต', 'Portfolio Value')}</div>
                        <div className="text-2xl font-bold text-white">
                            {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_current_value || 0), displayCurrency)}
                        </div>
                    </div>
                    <div className={`bg-gradient-to-br ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0
                        ? 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30'
                        : 'from-rose-500/20 to-rose-600/10 border-rose-500/30'} rounded-xl border p-4`}>
                        <div className={`text-sm ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t('กำไร/ขาดทุน', 'Profit/Loss')}
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_unrealized_pnl || 0), displayCurrency)}
                        </div>
                    </div>
                </div>

                {/* Account Analysis with Goal Progress */}
                {accountAnalysis.length > 0 && (
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">🎯 {t('วิเคราะห์ตามบัญชี', 'Account Analysis')}</h2>
                            <p className="text-xs text-gray-500 mt-1">{t('เปรียบเทียบกับเป้าหมาย พร้อมแยก Spot และ Futures', 'Compare with goals, breakdown by Spot and Futures')}</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-700/30">
                                    <tr className="text-gray-400 text-sm">
                                        <th className="px-6 py-3 text-left">{t('บัญชี', 'Account')}</th>
                                        <th className="px-4 py-3 text-right">{t('Spot มูลค่า', 'Spot Value')}</th>
                                        <th className="px-4 py-3 text-right">{t('Spot P&L', 'Spot P&L')}</th>
                                        <th className="px-4 py-3 text-right">{t('Futures Realized', 'Futures Realized')}</th>
                                        <th className="px-4 py-3 text-right">{t('Futures Unrealized', 'Futures Unrealized')}</th>
                                        <th className="px-4 py-3 text-right">{t('รวม', 'Total')}</th>
                                        <th className="px-4 py-3 text-right">{t('เป้าหมาย', 'Goal')}</th>
                                        <th className="px-4 py-3 text-center">{t('Progress', 'Progress')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountAnalysis.map((item) => (
                                        <tr key={item.account.id} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-3 h-3 rounded-full"
                                                        style={{ backgroundColor: item.account.color || '#10b981' }}
                                                    />
                                                    <div>
                                                        <div className="font-semibold text-white">{item.account.name}</div>
                                                        {item.account.description && (
                                                            <div className="text-xs text-gray-500">{item.account.description}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-right text-white font-mono">
                                                {formatCurrency(convertToDisplayCurrency(item.spotValue, item.account.target_currency), displayCurrency)}
                                            </td>
                                            <td className={`px-4 py-4 text-right font-mono ${item.spotUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {item.spotUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(item.spotUnrealizedPnL, item.account.target_currency), displayCurrency)}
                                            </td>
                                            <td className={`px-4 py-4 text-right font-mono ${item.futuresRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {item.futuresRealizedPnL >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(item.futuresRealizedPnL, item.account.target_currency), displayCurrency)}
                                            </td>
                                            <td className={`px-4 py-4 text-right font-mono ${item.futuresUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {item.futuresUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(item.futuresUnrealizedPnL, item.account.target_currency), displayCurrency)}
                                            </td>
                                            <td className="px-4 py-4 text-right font-mono font-bold text-white">
                                                {formatCurrency(convertToDisplayCurrency(item.totalValue, item.account.target_currency), displayCurrency)}
                                            </td>
                                            <td className="px-4 py-4 text-right text-gray-400">
                                                {item.account.target_value
                                                    ? formatCurrency(convertToDisplayCurrency(item.account.target_value, item.account.target_currency), displayCurrency)
                                                    : '-'
                                                }
                                            </td>
                                            <td className="px-4 py-4">
                                                {item.account.target_value ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full transition-all"
                                                                style={{
                                                                    width: `${Math.min(item.goalProgress, 100)}%`,
                                                                    backgroundColor: item.account.color || '#10b981',
                                                                }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs font-mono ${item.goalProgress >= 100 ? 'text-emerald-400' : 'text-gray-400'}`}>
                                                            {item.goalProgress.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-500 text-xs">{t('ไม่มีเป้า', 'No goal')}</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                {/* Total row */}
                                <tfoot className="bg-gray-700/40">
                                    <tr className="border-t-2 border-gray-600">
                                        <td className="px-6 py-3 text-white font-bold">{t('รวมทั้งหมด', 'Grand Total')}</td>
                                        <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.spotValue, 0)), displayCurrency)}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${accountAnalysis.reduce((s, a) => s + a.spotUnrealizedPnL, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {accountAnalysis.reduce((s, a) => s + a.spotUnrealizedPnL, 0) >= 0 ? '+' : ''}
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.spotUnrealizedPnL, 0)), displayCurrency)}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${accountAnalysis.reduce((s, a) => s + a.futuresRealizedPnL, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {accountAnalysis.reduce((s, a) => s + a.futuresRealizedPnL, 0) >= 0 ? '+' : ''}
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.futuresRealizedPnL, 0)), displayCurrency)}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${accountAnalysis.reduce((s, a) => s + a.futuresUnrealizedPnL, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {accountAnalysis.reduce((s, a) => s + a.futuresUnrealizedPnL, 0) >= 0 ? '+' : ''}
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.futuresUnrealizedPnL, 0)), displayCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.totalValue, 0)), displayCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-400 font-bold">
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + (a.account.target_value || 0), 0)), displayCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {(() => {
                                                const totalGoal = accountAnalysis.reduce((s, a) => s + (a.account.target_value || 0), 0);
                                                const totalValue = accountAnalysis.reduce((s, a) => s + a.totalValue, 0);
                                                const pct = totalGoal > 0 ? (totalValue / totalGoal) * 100 : 0;
                                                return (
                                                    <span className={`font-mono font-bold ${pct >= 100 ? 'text-emerald-400' : 'text-white'}`}>
                                                        {pct.toFixed(1)}%
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Gainers */}
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">📈 {t('กำไรสูงสุด', 'Top Gainers')}</h2>
                        </div>
                        <div className="divide-y divide-gray-700/50">
                            {analysis?.topGainers.map((item, idx) => (
                                <div key={item.symbol} className="px-6 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-500 text-sm w-6">#{idx + 1}</span>
                                        <div>
                                            <div className="font-semibold text-white">{item.symbol}</div>
                                            <div className="text-xs text-gray-500">{getAssetTypeName(item.assetType, settings.language)}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`font-mono ${item.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {item.pnlPercent >= 0 ? '+' : ''}{item.pnlPercent.toFixed(2)}%
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {formatCurrency(convertToDisplayCurrency(item.currentValue), displayCurrency)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {(!analysis?.topGainers || analysis.topGainers.length === 0) && (
                                <div className="px-6 py-8 text-center text-gray-500">
                                    {t('ยังไม่มีข้อมูล', 'No data yet')}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Top Losers */}
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">📉 {t('ขาดทุนสูงสุด', 'Top Losers')}</h2>
                        </div>
                        <div className="divide-y divide-gray-700/50">
                            {analysis?.topLosers.filter(l => l.pnlPercent < 0).map((item, idx) => (
                                <div key={item.symbol} className="px-6 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-500 text-sm w-6">#{idx + 1}</span>
                                        <div>
                                            <div className="font-semibold text-white">{item.symbol}</div>
                                            <div className="text-xs text-gray-500">{getAssetTypeName(item.assetType, settings.language)}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-mono text-rose-400">
                                            {item.pnlPercent.toFixed(2)}%
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {formatCurrency(convertToDisplayCurrency(item.currentValue), displayCurrency)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {(!analysis?.topLosers || analysis.topLosers.filter(l => l.pnlPercent < 0).length === 0) && (
                                <div className="px-6 py-8 text-center text-gray-500">
                                    {t('ไม่มีรายการขาดทุน', 'No losing positions')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Largest Positions */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-700/50">
                        <h2 className="text-lg font-semibold text-white">💰 {t('ตำแหน่งใหญ่สุด', 'Largest Positions')}</h2>
                    </div>
                    <div className="divide-y divide-gray-700/50">
                        {analysis?.largestPositions.map((item, idx) => (
                            <div key={item.symbol} className="px-6 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-500 text-sm w-6">#{idx + 1}</span>
                                    <div>
                                        <div className="font-semibold text-white">{item.symbol}</div>
                                        <div className="text-xs text-gray-500">
                                            {getAssetTypeName(item.assetType, settings.language)} • {formatNumber(item.quantity)} units
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-mono text-white">
                                        {formatCurrency(convertToDisplayCurrency(item.currentValue), displayCurrency)}
                                    </div>
                                    <div className={`text-xs ${item.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {item.pnlPercent >= 0 ? '+' : ''}{item.pnlPercent.toFixed(2)}%
                                    </div>
                                </div>
                            </div>
                        ))}
                        {(!analysis?.largestPositions || analysis.largestPositions.length === 0) && (
                            <div className="px-6 py-8 text-center text-gray-500">
                                {t('ยังไม่มีข้อมูล', 'No data yet')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Asset Type Breakdown */}
                {analysis?.byAssetType && Object.keys(analysis.byAssetType).length > 0 && (
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">📊 {t('สัดส่วนประเภทสินทรัพย์', 'Asset Type Breakdown')}</h2>
                        </div>
                        <div className="p-6">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                {Object.entries(analysis.byAssetType).map(([type, value]) => {
                                    const total = Object.values(analysis.byAssetType).reduce((a, b) => a + b, 0);
                                    const percent = total > 0 ? (value / total) * 100 : 0;
                                    return (
                                        <div key={type} className="bg-gray-700/30 rounded-lg p-4 text-center">
                                            <div className="text-gray-400 text-sm mb-1">{getAssetTypeName(type as any, settings.language)}</div>
                                            <div className="text-white font-bold">{percent.toFixed(1)}%</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {formatCurrency(convertToDisplayCurrency(value), displayCurrency)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Monthly Purchase Performance */}
                {analysis?.monthlyPerformance && analysis.monthlyPerformance.length > 0 && (
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">📈 {t('ผลการลงทุนรายเดือน', 'Monthly Purchase Performance')}</h2>
                            <p className="text-xs text-gray-500 mt-1">{t('เปรียบเทียบต้นทุนกับมูลค่าปัจจุบันของการซื้อแต่ละเดือน', 'Compare cost vs current value of purchases by month')}</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-700/30">
                                    <tr className="text-gray-400 text-sm">
                                        <th className="px-6 py-3 text-left">{t('เดือน', 'Month')}</th>
                                        <th className="px-6 py-3 text-right">{t('ต้นทุน', 'Cost')}</th>
                                        <th className="px-6 py-3 text-right">{t('มูลค่าปัจจุบัน', 'Current Value')}</th>
                                        <th className="px-6 py-3 text-right">{t('กำไร/ขาดทุน', 'P&L')}</th>
                                        <th className="px-6 py-3 text-right">%</th>
                                        <th className="px-6 py-3 text-right">{t('รายการ', 'Trades')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {analysis.monthlyPerformance.map((perf) => (
                                        <tr key={perf.month} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                                            <td className="px-6 py-3 text-white font-medium">{perf.month}</td>
                                            <td className="px-6 py-3 text-right text-gray-300">
                                                {formatCurrency(convertToDisplayCurrency(perf.totalInvested), displayCurrency)}
                                            </td>
                                            <td className="px-6 py-3 text-right text-white">
                                                {formatCurrency(convertToDisplayCurrency(perf.currentValue), displayCurrency)}
                                            </td>
                                            <td className={`px-6 py-3 text-right font-medium ${perf.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {perf.pnl >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(perf.pnl), displayCurrency)}
                                            </td>
                                            <td className={`px-6 py-3 text-right font-mono ${perf.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {perf.pnlPercent >= 0 ? '+' : ''}{perf.pnlPercent.toFixed(2)}%
                                            </td>
                                            <td className="px-6 py-3 text-right text-gray-400">{perf.purchaseCount}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {/* Total row */}
                                <tfoot className="bg-gray-700/40">
                                    <tr className="border-t-2 border-gray-600">
                                        <td className="px-6 py-3 text-white font-bold">{t('รวม', 'Total')}</td>
                                        <td className="px-6 py-3 text-right text-gray-300 font-bold">
                                            {formatCurrency(convertToDisplayCurrency(
                                                analysis.monthlyPerformance.reduce((sum, p) => sum + p.totalInvested, 0)
                                            ), displayCurrency)}
                                        </td>
                                        <td className="px-6 py-3 text-right text-white font-bold">
                                            {formatCurrency(convertToDisplayCurrency(
                                                analysis.monthlyPerformance.reduce((sum, p) => sum + p.currentValue, 0)
                                            ), displayCurrency)}
                                        </td>
                                        <td className={`px-6 py-3 text-right font-bold ${analysis.monthlyPerformance.reduce((sum, p) => sum + p.pnl, 0) >= 0
                                            ? 'text-emerald-400' : 'text-rose-400'
                                            }`}>
                                            {analysis.monthlyPerformance.reduce((sum, p) => sum + p.pnl, 0) >= 0 ? '+' : ''}
                                            {formatCurrency(convertToDisplayCurrency(
                                                analysis.monthlyPerformance.reduce((sum, p) => sum + p.pnl, 0)
                                            ), displayCurrency)}
                                        </td>
                                        <td className={`px-6 py-3 text-right font-mono font-bold ${(() => {
                                            const totalInvested = analysis.monthlyPerformance.reduce((sum, p) => sum + p.totalInvested, 0);
                                            const totalPnl = analysis.monthlyPerformance.reduce((sum, p) => sum + p.pnl, 0);
                                            return totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
                                        })() >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                            }`}>
                                            {(() => {
                                                const totalInvested = analysis.monthlyPerformance.reduce((sum, p) => sum + p.totalInvested, 0);
                                                const totalPnl = analysis.monthlyPerformance.reduce((sum, p) => sum + p.pnl, 0);
                                                const pct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
                                                return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                                            })()}
                                        </td>
                                        <td className="px-6 py-3 text-right text-gray-400 font-bold">
                                            {analysis.monthlyPerformance.reduce((sum, p) => sum + p.purchaseCount, 0)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {/* Monthly Activity */}
                {analysis?.recentMonths && analysis.recentMonths.length > 0 && (
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50">
                            <h2 className="text-lg font-semibold text-white">📅 {t('กิจกรรมรายเดือน', 'Monthly Activity')}</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-700/30">
                                    <tr className="text-gray-400 text-sm">
                                        <th className="px-6 py-3 text-left">{t('เดือน', 'Month')}</th>
                                        <th className="px-6 py-3 text-right">{t('ซื้อ', 'Buys')}</th>
                                        <th className="px-6 py-3 text-right">{t('ขาย', 'Sells')}</th>
                                        <th className="px-6 py-3 text-right">{t('รายการ', 'Count')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {analysis.recentMonths.map(([month, data]) => (
                                        <tr key={month} className="border-t border-gray-700/50">
                                            <td className="px-6 py-3 text-white font-medium">{month}</td>
                                            <td className="px-6 py-3 text-right text-emerald-400">
                                                {formatCurrency(convertToDisplayCurrency(data.buys), displayCurrency)}
                                            </td>
                                            <td className="px-6 py-3 text-right text-rose-400">
                                                {formatCurrency(convertToDisplayCurrency(data.sells), displayCurrency)}
                                            </td>
                                            <td className="px-6 py-3 text-right text-gray-400">{data.count}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
