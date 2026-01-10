'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Transaction, PortfolioResponse } from '@/types';
import { getTransactions, getPortfolio, formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, getAllExchangeRates } from '@/lib/api';
import { calculatePnlMetrics } from '@/lib/pnl-utils';
import TransactionList from '@/components/TransactionList';
import { useSettings } from '@/contexts/SettingsContext';
import Header from '@/components/Header';
import AssetLogo from '@/components/AssetLogo';

export default function ReportsPage() {
    const { t, settings, displayCurrency, setDisplayCurrency } = useSettings();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Modal state for viewing details (either from Tag or Summary Card)
    const [modalState, setModalState] = useState<{
        title: string;
        filter: (tx: Transaction) => boolean;
        type: 'tag' | 'card';
    } | null>(null);

    const currencyOptions = [
        { value: 'THB' as const, icon: '🇹🇭' },
        { value: 'USD' as const, icon: '🇺🇸' },
        { value: 'BTC' as const, icon: '₿' },
    ];

    // Load data
    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                const [txData, portfolioData] = await Promise.all([
                    getTransactions(),
                    getPortfolio(),
                ]);
                setTransactions(txData);
                setPortfolio(portfolioData);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    // Fetch exchange rates
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [isLoadingRates, setIsLoadingRates] = useState(false);
    const baseCurrency = settings.defaultCurrency;

    useEffect(() => {
        const fetchRates = async () => {
            setIsLoadingRates(true);
            try {
                const rates = await getAllExchangeRates(baseCurrency);
                setExchangeRates(rates.rates);
            } catch (err) {
                console.error('Failed to fetch exchange rates:', err);
            } finally {
                setIsLoadingRates(false);
            }
        };
        fetchRates();
    }, [baseCurrency]);

    // Convert value to display currency
    const convertToDisplayCurrency = useCallback((value: number, fromCurrency: string = baseCurrency): number => {
        if (displayCurrency === fromCurrency) return value;

        let valueInBase = value;
        if (fromCurrency !== baseCurrency && exchangeRates[fromCurrency]) {
            // Convert to base first
            valueInBase = value / exchangeRates[fromCurrency];
        }

        if (displayCurrency === baseCurrency) return valueInBase;

        const rate = exchangeRates[displayCurrency];
        if (!rate) return valueInBase;

        return valueInBase * rate;
    }, [displayCurrency, exchangeRates, baseCurrency]);

    // Helper to determine transaction currency
    const getEffectiveCurrency = (tx: Transaction): string => {
        if (tx.currency) return tx.currency.toUpperCase();

        // Fallback based on market if currency is missing
        if (tx.market) {
            const m = tx.market.toLowerCase();
            if (['binance', 'okx', 'htx', 'kucoin', 'bybit', 'gate', 'mexc'].includes(m)) return 'USDT';
            if (['nyse', 'nasdaq', 'amex', 'coinbase', 'comex', 'lbma', 'forex'].includes(m)) return 'USD';
            if (['set', 'mai', 'tfex', 'bitkub'].includes(m)) return 'THB';
        }

        // Fallback based on Symbol (common defaults)
        const sym = tx.symbol.toUpperCase();
        if (['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA'].includes(sym)) return 'USDT';
        if (['XAU', 'XAG', 'USDT'].includes(sym)) return 'USD';

        // Default to base currency (likely THB)
        return baseCurrency;
    };

    // Helper functions for action types
    const isOpenAction = (action: string) => action === 'buy' || action === 'long';
    const isCloseAction = (action: string) => action === 'sell' || action === 'short' || action === 'close_long' || action === 'close_short';

    const getActionLabel = (action: string) => {
        switch (action) {
            case 'buy': return t('ซื้อ', 'Buy');
            case 'sell': return t('ขาย', 'Sell');
            case 'long': return 'Open Long';
            case 'short': return 'Open Short';
            case 'close_long': return 'Close Long';
            case 'close_short': return 'Close Short';
            default: return action;
        }
    };

    const getActionColor = (action: string) => {
        switch (action) {
            case 'buy':
            case 'long':
                return 'bg-emerald-500/20 text-emerald-400';
            case 'sell':
            case 'close_long':
                return 'bg-rose-500/20 text-rose-400';
            case 'short':
                return 'bg-rose-500/20 text-rose-400';
            case 'close_short':
                return 'bg-purple-500/20 text-purple-400';
            default:
                return 'bg-gray-500/20 text-gray-400';
        }
    };

    // Get all unique tags from transactions
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        transactions.forEach(tx => {
            (tx.tags || []).forEach(tag => tagSet.add(tag));
        });
        return Array.from(tagSet).sort();
    }, [transactions]);

    // Filter transactions
    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            // Tag filter
            if (selectedTags.length > 0) {
                const txTags = tx.tags || [];
                if (!selectedTags.some(tag => txTags.includes(tag))) {
                    return false;
                }
            }
            // Date filter
            if (dateFrom) {
                const txDate = new Date(tx.timestamp);
                const fromDate = new Date(dateFrom);
                if (txDate < fromDate) return false;
            }
            if (dateTo) {
                const txDate = new Date(tx.timestamp);
                const toDate = new Date(dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (txDate > toDate) return false;
            }
            return true;
        });
    }, [transactions, selectedTags, dateFrom, dateTo]);

    // Calculate P&L metrics for all transactions (Normalized to Base Currency)
    const pnlMetrics = useMemo(() => {
        if (!portfolio || Object.keys(exchangeRates).length === 0) return {};

        // Helper to convert to Base Currency
        const toBase = (amount: number, currency: string) => {
            if (currency === baseCurrency) return amount;
            const rate = exchangeRates[currency] || exchangeRates[currency.toUpperCase()];
            // Safe fallback: don't return raw amount if currency differs
            return rate ? amount / rate : 0;
        };

        // 1. Normalize current prices to Base Currency
        const prices: Record<string, number> = {};
        portfolio.assets.forEach(a => {
            prices[a.symbol] = toBase(a.current_price, a.currency);
        });

        // 2. Normalize transactions to Base Currency for calculation
        // We create a shallow copy with modified price valid ONLY for calculation
        const calcTransactions = transactions.map(tx => ({
            ...tx,
            price: toBase(tx.price, getEffectiveCurrency(tx))
        }));

        return calculatePnlMetrics(calcTransactions, prices);
    }, [transactions, portfolio, exchangeRates, baseCurrency]);

    // Calculate summary by tags (separating Spot and Futures)
    const tagSummary = useMemo(() => {
        const summary: Record<string, {
            buys: number; sells: number;
            longs: number; shorts: number; closeLongs: number; closeShorts: number;
            fees: number; count: number;
            realizedPnl: number; unrealizedPnl: number;
        }> = {};

        // Iterate filtered transactions to aggregate values
        filteredTransactions.forEach(tx => {
            const txTags = tx.tags?.length ? tx.tags : ['Untagged'];
            const value = tx.quantity * tx.price * (tx.leverage || 1);
            const metrics = pnlMetrics[tx.id];

            txTags.forEach(tag => {
                if (!summary[tag]) {
                    summary[tag] = {
                        buys: 0, sells: 0,
                        longs: 0, shorts: 0, closeLongs: 0, closeShorts: 0,
                        fees: 0, count: 0,
                        realizedPnl: 0, unrealizedPnl: 0
                    };
                }

                // Categorize by action type
                switch (tx.action.toLowerCase()) {
                    case 'buy':
                        summary[tag].buys += value;
                        break;
                    case 'sell':
                        summary[tag].sells += value;
                        break;
                    case 'long':
                        summary[tag].longs += value;
                        break;
                    case 'short':
                        summary[tag].shorts += value;
                        break;
                    case 'close_long':
                        summary[tag].closeLongs += value;
                        break;
                    case 'close_short':
                        summary[tag].closeShorts += value;
                        break;
                    case 'close':
                        summary[tag].closeLongs += value;
                        break;
                }

                summary[tag].fees += tx.fees;
                summary[tag].count += 1;

                // Aggregate P&L from metrics
                if (metrics) {
                    summary[tag].realizedPnl += metrics.realizedPnl;
                    summary[tag].unrealizedPnl += metrics.unrealizedPnl;
                }
            });
        });

        return Object.entries(summary).map(([tag, data]) => {
            // Net P&L = Realized + Unrealized - Fees
            // Note: Data.fees is in asset currency usually, but here we assume standardized or converted if needed.
            // Ideally fees should be subtracted from P&L.
            const totalNet = data.realizedPnl + data.unrealizedPnl - data.fees;

            return {
                tag,
                ...data,
                closes: data.closeLongs + data.closeShorts,
                // Keep Spot/Futures net flow for reference if needed, or remove? 
                // Keeping them but they are Cash Flow, not P&L.
                spotNet: data.sells - data.buys,
                futuresNet: (data.closeLongs - data.longs) + (data.shorts - data.closeShorts),
                totalNet,
            };
        }).sort((a, b) => b.count - a.count);
    }, [filteredTransactions, pnlMetrics]);

    // Total summary
    const totalSummary = useMemo(() => {
        return filteredTransactions.reduce((acc, tx) => {
            const value = tx.quantity * tx.price * (tx.leverage || 1);
            switch (tx.action) {
                case 'buy':
                    acc.buys += value;
                    break;
                case 'sell':
                    acc.sells += value;
                    break;
                case 'long':
                    acc.longs += value;
                    break;
                case 'short':
                    acc.shorts += value;
                    break;
                case 'close_long':
                case 'close_short':
                    acc.closes += value;
                    break;
            }
            acc.fees += tx.fees;
            acc.count += 1;
            return acc;
        }, { buys: 0, sells: 0, longs: 0, shorts: 0, closes: 0, fees: 0, count: 0 });
    }, [filteredTransactions]);

    const toggleTag = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        );
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const locale = settings.language === 'th' ? 'th-TH' : 'en-US';
        return date.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    if (isLoading) {
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
                currentPage="reports"
                showCurrencySelector={true}
                currencyValue={displayCurrency}
                onCurrencyChange={(val) => setDisplayCurrency(val as 'THB' | 'USD' | 'BTC')}
                currencyOptions={currencyOptions}
            />

            {/* Main content */}
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

                {/* Filters */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 space-y-4">
                    <h2 className="text-lg font-semibold text-white">{t('ตัวกรอง', 'Filters')}</h2>

                    {/* Tag Filter */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">🏷️ {t('แท็ก', 'Tags')}</label>
                        <div className="flex flex-wrap gap-2">
                            {allTags.length === 0 ? (
                                <span className="text-gray-500 text-sm">{t('ยังไม่มีแท็ก', 'No tags yet')}</span>
                            ) : (
                                allTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedTags.includes(tag)
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                                            }`}
                                    >
                                        {tag}
                                    </button>
                                ))
                            )}
                            {selectedTags.length > 0 && (
                                <button
                                    onClick={() => setSelectedTags([])}
                                    className="px-3 py-1.5 rounded-lg text-sm font-medium text-rose-400 hover:bg-rose-500/20 transition-all"
                                >
                                    {t('ล้างทั้งหมด', 'Clear all')}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Date Range Filter */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">📅 {t('ตั้งแต่', 'From')}</label>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">📅 {t('ถึง', 'To')}</label>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </div>
                </div>

                {/* Summary Cards - Row 1: Spot Trading */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div
                        className="relative bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-blue-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('รายการทั้งหมด', 'Total Transactions'),
                            filter: () => true,
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-blue-400 text-sm">{t('รายการทั้งหมด', 'Total Transactions')}</div>
                            <div className="text-2xl font-bold text-white">{totalSummary.count}</div>
                        </div>
                    </div>
                    {/* Spot Buy */}
                    <div
                        className="relative bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-emerald-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('ยอดซื้อ (Spot)', 'Total Buy (Spot)'),
                            filter: (tx) => tx.action === 'buy',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-emerald-400 text-sm">{t('ยอดซื้อ', 'Total Buy')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.buys), displayCurrency)}</div>
                            <div className="text-xs text-gray-500 mt-1">Spot</div>
                        </div>
                    </div>
                    {/* Spot Sell */}
                    <div
                        className="relative bg-gradient-to-br from-rose-500/20 to-rose-600/10 rounded-xl border border-rose-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-rose-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('ยอดขาย (Spot)', 'Total Sell (Spot)'),
                            filter: (tx) => tx.action === 'sell',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-rose-400 text-sm">{t('ยอดขาย', 'Total Sell')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.sells), displayCurrency)}</div>
                            <div className="text-xs text-gray-500 mt-1">Spot</div>
                        </div>
                    </div>
                    {/* Total Fees */}
                    <div
                        className="relative bg-gradient-to-br from-amber-500/20 to-amber-600/10 rounded-xl border border-amber-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-amber-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('ค่าธรรมเนียมรวม', 'Total Fees'),
                            filter: (tx) => tx.fees > 0,
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.121 15.536c-1.171 1.952-3.07 1.952-4.242 0-1.172-1.953-1.172-5.119 0-7.072 1.171-1.952 3.07-1.952 4.242 0M8 10.5h4m-4 3h4m9-1.5a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-amber-400 text-sm">{t('ค่าธรรมเนียมรวม', 'Total Fees')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.fees), displayCurrency)}</div>
                        </div>
                    </div>
                    {/* Net Spot */}
                    <div
                        className={`relative bg-gradient-to-br ${totalSummary.buys - totalSummary.sells >= 0
                            ? 'from-teal-500/20 to-teal-600/10 border-teal-500/30 hover:bg-teal-500/10'
                            : 'from-orange-500/20 to-orange-600/10 border-orange-500/30 hover:bg-orange-500/10'} rounded-xl border p-4 min-h-[100px] overflow-hidden group cursor-pointer transition-all`}
                        onClick={() => setModalState({
                            title: t('สถานะ Spot (Buy - Sell)', 'Net Spot (Buy - Sell)'),
                            filter: (tx) => tx.action === 'buy' || tx.action === 'sell',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className={`w-16 h-16 ${totalSummary.buys - totalSummary.sells >= 0 ? 'text-teal-400' : 'text-orange-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className={totalSummary.buys - totalSummary.sells >= 0 ? 'text-teal-400 text-sm' : 'text-orange-400 text-sm'}>
                                {t('สถานะ Spot', 'Net Spot')}
                            </div>
                            <div className="text-2xl font-bold text-white">
                                {formatCurrency(convertToDisplayCurrency(totalSummary.buys - totalSummary.sells), displayCurrency)}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{t('ซื้อ - ขาย', 'Buy - Sell')}</div>
                        </div>
                    </div>
                </div>

                {/* Summary Cards - Row 2: Futures & P&L */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {/* Futures Long */}
                    <div
                        className="relative bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl border border-green-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-green-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('รายการ Long (Futures)', 'Long Positions (Futures)'),
                            filter: (tx) => tx.action === 'long',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-green-400 text-sm">{t('มูลค่า Long', 'Total Long')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.longs), displayCurrency)}</div>
                            <div className="text-xs text-gray-500 mt-1">Futures</div>
                        </div>
                    </div>
                    {/* Futures Short */}
                    <div
                        className="relative bg-gradient-to-br from-red-500/20 to-red-600/10 rounded-xl border border-red-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-red-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('รายการ Short (Futures)', 'Short Positions (Futures)'),
                            filter: (tx) => tx.action === 'short',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-red-400 text-sm">{t('มูลค่า Short', 'Total Short')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.shorts), displayCurrency)}</div>
                            <div className="text-xs text-gray-500 mt-1">Futures</div>
                        </div>
                    </div>
                    {/* Total Closes */}
                    <div
                        className="relative bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/30 p-4 min-h-[100px] overflow-hidden group cursor-pointer hover:bg-purple-500/10 transition-all"
                        onClick={() => setModalState({
                            title: t('รายการปิดสถานะ (Close Long/Short)', 'Closed Positions (Futures)'),
                            filter: (tx) => tx.action === 'close_long' || tx.action === 'close_short',
                            type: 'card'
                        })}
                    >
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg className="w-16 h-16 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className="text-purple-400 text-sm">{t('ปิดสถานะ', 'Closes')}</div>
                            <div className="text-2xl font-bold text-white">{formatCurrency(convertToDisplayCurrency(totalSummary.closes), displayCurrency)}</div>
                            <div className="text-xs text-gray-500 mt-1">Close Long/Short</div>
                        </div>
                    </div>
                    {/* Unrealized P&L */}
                    <div
                        className={`relative bg-gradient-to-br ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0
                            ? 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 hover:bg-emerald-500/10'
                            : 'from-rose-500/20 to-rose-600/10 border-rose-500/30 hover:bg-rose-500/10'} rounded-xl border p-4 min-h-[100px] overflow-hidden group cursor-pointer transition-all`}
                        onClick={() => setModalState({
                            title: t('รายการสินทรัพย์คงเหลือ (Unrealized P&L)', 'Assets contributing to Unrealized P&L'),
                            // Show all open positions (Buy/Long/Short)
                            filter: (tx) => {
                                const m = pnlMetrics[tx.id];
                                return !!m && !m.isClosed;
                            },
                            type: 'card'
                        })}
                    >
                        <div className={`absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className={`text-sm ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {t('กำไรยังไม่รับรู้', 'Unrealized P&L')}
                            </div>
                            <div className="text-2xl font-bold text-white">
                                {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_unrealized_pnl || 0), displayCurrency)}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {(portfolio?.summary.total_unrealized_pnl_percent || 0) >= 0 ? '+' : ''}
                                {(portfolio?.summary.total_unrealized_pnl_percent || 0).toFixed(2)}%
                            </div>
                        </div>
                    </div>
                    {/* Realized P&L */}
                    <div
                        className={`relative bg-gradient-to-br ${(portfolio?.summary.total_realized_pnl || 0) >= 0
                            ? 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 hover:bg-cyan-500/10'
                            : 'from-orange-500/20 to-orange-600/10 border-orange-500/30 hover:bg-orange-500/10'} rounded-xl border p-4 min-h-[100px] overflow-hidden group cursor-pointer transition-all`}
                        onClick={() => setModalState({
                            title: t('รายการรับรู้กำไร/ขาดทุน (Realized P&L)', 'Realized P&L Transactions'),
                            // Show transactions that have realized P&L > 0 (Sell, Close Long/Short)
                            filter: (tx) => {
                                const m = pnlMetrics[tx.id];
                                return !!m && Math.abs(m.realizedPnl) > 0;
                            },
                            type: 'card'
                        })}
                    >
                        <div className={`absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${(portfolio?.summary.total_realized_pnl || 0) >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
                            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="relative">
                            <div className={`text-sm ${(portfolio?.summary.total_realized_pnl || 0) >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
                                {t('กำไรรับรู้แล้ว', 'Realized P&L')}
                            </div>
                            <div className="text-2xl font-bold text-white">
                                {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_realized_pnl || 0), displayCurrency)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tag Summary Table */}
                {tagSummary.length > 0 && (
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center gap-3">
                            <div className="p-2 bg-purple-500/20 rounded-lg">
                                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                            </div>
                            <h2 className="text-lg font-semibold text-white">{t('สรุปตามแท็ก', 'Summary by Tag')}</h2>
                            <span className="ml-auto text-sm text-gray-500">{tagSummary.length} {t('แท็ก', 'tags')}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-700/20 text-gray-500 text-xs uppercase tracking-wider">
                                        <th className="px-4 py-2 text-left" rowSpan={2}>{t('แท็ก', 'Tag')}</th>
                                        <th className="px-4 py-2 text-center" rowSpan={2}>{t('จำนวน', 'Count')}</th>
                                        <th className="px-4 py-2 text-center border-x border-gray-700/30" colSpan={2}>
                                            <span className="text-gray-400">Spot</span>
                                        </th>
                                        <th className="px-4 py-2 text-center border-r border-gray-700/30" colSpan={3}>
                                            <span className="text-gray-400">Futures</span>
                                        </th>
                                        <th className="px-4 py-2 text-center" rowSpan={2}>{t('ค่าธรรมเนียม', 'Fees')}</th>
                                        <th className="px-4 py-2 text-right" rowSpan={2}>{t('กำไร/ขาดทุน', 'Net P&L')}</th>
                                    </tr>
                                    <tr className="bg-gray-700/10 text-gray-400">
                                        <th className="px-3 py-2 text-right border-l border-gray-700/30">
                                            <span className="flex items-center justify-end gap-1">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>Buy
                                            </span>
                                        </th>
                                        <th className="px-3 py-2 text-right border-r border-gray-700/30">
                                            <span className="flex items-center justify-end gap-1">
                                                <span className="w-2 h-2 rounded-full bg-rose-400"></span>Sell
                                            </span>
                                        </th>
                                        <th className="px-3 py-2 text-right">
                                            <span className="flex items-center justify-end gap-1">
                                                <span className="w-2 h-2 rounded-full bg-blue-400"></span>Long
                                            </span>
                                        </th>
                                        <th className="px-3 py-2 text-right">
                                            <span className="flex items-center justify-end gap-1">
                                                <span className="w-2 h-2 rounded-full bg-purple-400"></span>Short
                                            </span>
                                        </th>
                                        <th className="px-3 py-2 text-right border-r border-gray-700/30">
                                            <span className="flex items-center justify-end gap-1">
                                                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>Close
                                            </span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tagSummary.map((row, index) => (
                                        <tr
                                            key={row.tag}
                                            className={`border-t border-gray-700/50 hover:bg-gray-700/20 transition-colors cursor-pointer ${index % 2 === 0 ? 'bg-gray-800/20' : ''}`}
                                            onClick={() => setModalState({
                                                title: `${t('แท็ก', 'Tag')}: ${row.tag}`,
                                                filter: (tx) => {
                                                    const txTags = tx.tags || [];
                                                    const isUntagged = row.tag === 'Untagged' && txTags.length === 0;
                                                    return txTags.includes(row.tag) || isUntagged;
                                                },
                                                type: 'tag'
                                            })}
                                        >
                                            <td className="px-4 py-3">
                                                <span className="text-gray-300 font-medium">
                                                    {row.tag}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className="inline-flex items-center justify-center w-8 h-8 bg-gray-700/50 text-gray-300 text-xs font-medium rounded-full">
                                                    {row.count}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-right text-emerald-400 border-l border-gray-700/30">
                                                {row.buys > 0 ? formatCurrency(convertToDisplayCurrency(row.buys), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right text-rose-400 border-r border-gray-700/30">
                                                {row.sells > 0 ? formatCurrency(convertToDisplayCurrency(row.sells), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right text-blue-400">
                                                {row.longs > 0 ? formatCurrency(convertToDisplayCurrency(row.longs), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right text-purple-400">
                                                {row.shorts > 0 ? formatCurrency(convertToDisplayCurrency(row.shorts), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right text-cyan-400 border-r border-gray-700/30">
                                                {row.closes > 0 ? formatCurrency(convertToDisplayCurrency(row.closes), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right text-amber-400">
                                                {row.fees > 0 ? formatCurrency(convertToDisplayCurrency(row.fees), displayCurrency) : <span className="text-gray-600">-</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold ${row.totalNet >= 0
                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                    : 'bg-rose-500/20 text-rose-400'
                                                    }`}>
                                                    {row.totalNet >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(convertToDisplayCurrency(row.totalNet)), displayCurrency)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Transactions List */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-700/50">
                        <h2 className="text-lg font-semibold text-white">
                            {t('รายการที่กรองแล้ว', 'Filtered Transactions')} ({filteredTransactions.length})
                        </h2>
                    </div>

                    {filteredTransactions.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            {t('ไม่พบรายการที่ตรงกับตัวกรอง', 'No transactions match the filter')}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-700/50">
                            {filteredTransactions.slice(0, 50).map(tx => {
                                // Calculate P&L for open positions
                                // Use P&L from metrics (which is normalized to Base Currency)
                                const leverage = tx.leverage || 1;
                                const cost = tx.quantity * tx.price * leverage;
                                const metric = pnlMetrics[tx.id];

                                let pnl = 0;
                                let showPnl = false;
                                let pnlPercent = 0;

                                // Helper function to convert transaction price to Base Currency for cost basis calculation
                                const toBase = (val: number, curr: string) => {
                                    if (curr === baseCurrency) return val;
                                    const rate = exchangeRates[curr] || exchangeRates[curr.toUpperCase()];
                                    // If rate is missing for a different currency, returning val is dangerous (mixes currencies).
                                    // But returning 0 breaks cost basis.
                                    // We should only calculate if rate exists. 
                                    return rate ? val / rate : 0;
                                };

                                if (metric) {
                                    if ((tx.action === 'buy' || tx.action === 'long' || tx.action === 'short') && !metric.isClosed) {
                                        // Open positions -> Unrealized P&L
                                        pnl = metric.unrealizedPnl;
                                        showPnl = true;

                                        // Calculate cost basis in THB for percentage
                                        // Use remainingQty if we want % on remaining, or original quantity if we want % on original?
                                        // Usually for "Unrealized P&L" on the list item, we show % relative to the *current holding cost*.
                                        const priceBase = toBase(tx.price, getEffectiveCurrency(tx));
                                        // Use remainingQty from metric to be precise about what generates this P&L
                                        const costBasisBase = metric.remainingQty * priceBase * leverage;

                                        pnlPercent = costBasisBase !== 0 ? (pnl / costBasisBase) * 100 : 0;
                                    } else if (Math.abs(metric.realizedPnl) > 0) {
                                        // Closed positions -> Realized P&L (if we want to show it? The previous code showed it for 'buy' only if not sold?)
                                        // The previous code only showed PnL for "buy/long/short" as unrealized.
                                        // Let's keep showing Unrealized for open positions primarily in this list.
                                    }
                                }

                                return (
                                    <div key={tx.id} className="px-6 py-4 hover:bg-gray-700/20 transition-colors">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(tx.action)}`}>
                                                    {getActionLabel(tx.action)}
                                                </span>
                                                <AssetLogo
                                                    symbol={tx.symbol}
                                                    assetType={tx.asset_type}
                                                    size="sm"
                                                    className="shadow-sm"
                                                />
                                                <span className="font-semibold text-white">{tx.symbol}</span>
                                                <span className="text-gray-400 text-sm">{getAssetTypeName(tx.asset_type, settings.language)}</span>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-white font-mono">
                                                    {formatCurrency(cost, tx.currency || 'THB')}
                                                    {tx.leverage && tx.leverage > 1 && (
                                                        <span className="text-xs text-amber-400 ml-1">(×{tx.leverage})</span>
                                                    )}
                                                </div>
                                                {showPnl && (
                                                    <div className={`text-sm font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {pnl >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(pnl), displayCurrency)}
                                                        <span className="text-xs ml-1">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                                                    </div>
                                                )}
                                                <div className="text-gray-500 text-xs">{formatDate(tx.timestamp)}</div>
                                            </div>
                                        </div>
                                        {(tx.tags || []).length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {tx.tags?.map((tag, idx) => (
                                                    <span key={idx} className="px-2 py-0.5 bg-gray-700/50 text-gray-400 text-xs rounded">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {filteredTransactions.length > 50 && (
                                <div className="px-6 py-4 text-center text-gray-500">
                                    {t('แสดง 50 รายการแรก', 'Showing first 50 transactions')}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Details Modal */}
                {modalState && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setModalState(null)}>
                        <div
                            className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className={`p-2 rounded-lg ${modalState.type === 'tag' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                        {modalState.type === 'tag' ? (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                            </svg>
                                        ) : (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                            </svg>
                                        )}
                                    </span>
                                    {modalState.title}
                                </h3>
                                <button
                                    onClick={() => setModalState(null)}
                                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                <TransactionList
                                    transactions={filteredTransactions.filter(modalState.filter)}
                                    isLoading={false}
                                    displayCurrency={displayCurrency}
                                    convertToDisplayCurrency={convertToDisplayCurrency}
                                    transactionMetrics={pnlMetrics}
                                />
                            </div>

                            <div className="p-4 border-t border-gray-800 bg-gray-800/20 text-center text-sm text-gray-500">
                                {filteredTransactions.filter(modalState.filter).length} {t('รายการ', 'transactions')}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
