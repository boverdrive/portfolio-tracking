'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import PortfolioSummary from '@/components/PortfolioSummary';
import AssetList from '@/components/AssetList';
import TransactionForm from '@/components/TransactionForm';
import TransactionList from '@/components/TransactionList';
import AccountManager from '@/components/AccountManager';
import PerformanceChart from '@/components/PerformanceChart';
import Footer from '@/components/Footer';
import AssetDetailsModal from '@/components/AssetDetailsModal';
import PortfolioDetailsModal from '@/components/PortfolioDetailsModal';
import { useSettings } from '@/contexts/SettingsContext';
import {
    getPortfolio,
    getTransactions,
    deleteTransaction,
    getAllExchangeRates,
    DisplayCurrency,
} from '@/lib/api';
import { Transaction, PortfolioResponse, PortfolioAsset, PortfolioSummary as PortfolioSummaryType } from '@/types';

export default function Dashboard() {
    const { t, displayCurrency, setDisplayCurrency } = useSettings();
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [activeTab, setActiveTab] = useState<'portfolio' | 'transactions'>('portfolio');
    const [error, setError] = useState<string | null>(null);

    // Global currency selector
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [isLoadingRates, setIsLoadingRates] = useState(false);

    // Account filter
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Editing transaction
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    const [selectedAsset, setSelectedAsset] = useState<PortfolioAsset | null>(null);
    const [selectedMetric, setSelectedMetric] = useState<'value' | 'invested' | 'unrealized' | 'realized' | null>(null);

    // Show closed positions toggle
    const [showClosedPositions, setShowClosedPositions] = useState(false);

    // Fetch exchange rates when display currency changes
    useEffect(() => {
        const fetchRates = async () => {
            setIsLoadingRates(true);
            try {
                // Get rates from THB to target currency
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

    // Convert value from source currency to display currency
    // API returns rates in format: getAllExchangeRates('THB') returns { USD: 0.028, BTC: 0.000000286 }
    // This means: 1 THB = 0.028 USD, 1 THB = 0.000000286 BTC
    // So to convert THB to target, we MULTIPLY by the rate
    const convertToDisplayCurrency = useCallback((value: number, fromCurrency: string = 'THB'): number => {
        if (displayCurrency === fromCurrency) return value;

        // Normalize source currency for rate lookup (USDT -> USD)
        // This ensures stablecoins use USD rates since our forex provider might not track crypto
        const normalizedFrom = ['USDT', 'USDC', 'BUSD', 'DAI'].includes(fromCurrency) ? 'USD' : fromCurrency;

        // Convert from source currency to THB first if needed
        let valueInThb = value;
        if (normalizedFrom !== 'THB' && exchangeRates[normalizedFrom]) {
            // Rate is how much display currency per 1 THB
            // To convert FROM this currency TO THB, we divide by rate
            valueInThb = value / exchangeRates[normalizedFrom];
        }

        // Then convert from THB to display currency
        if (displayCurrency === 'THB') return valueInThb;

        const rate = exchangeRates[displayCurrency];
        if (!rate) return valueInThb;

        // Rate is how much display currency per 1 THB, so MULTIPLY
        return valueInThb * rate;
    }, [displayCurrency, exchangeRates]);

    // Filter transactions by selected account
    const filteredTransactions = useMemo(() => {
        if (!selectedAccountId) return transactions;
        return transactions.filter(tx => tx.account_id === selectedAccountId);
    }, [transactions, selectedAccountId]);

    // Get unique symbols from filtered transactions (for asset filtering)
    const accountSymbols = useMemo(() => {
        if (!selectedAccountId) return null; // null means show all
        const symbols = new Set<string>();
        filteredTransactions.forEach(tx => {
            // Create a unique key combining symbol, asset_type, and market
            const key = `${tx.symbol}:${tx.asset_type}:${tx.market || ''}`;
            symbols.add(key);
        });
        return symbols;
    }, [filteredTransactions, selectedAccountId]);

    // Convert assets to display currency and filter by account
    const getConvertedAssets = useCallback((): PortfolioAsset[] => {
        if (!portfolio) return [];

        let assets = portfolio.assets;

        // Filter by account if selected
        if (accountSymbols) {
            assets = assets.filter(asset => {
                const key = `${asset.symbol}:${asset.asset_type}:${asset.market || ''}`;
                return accountSymbols.has(key);
            });
        }

        return assets.map(asset => {
            const converted_avg_cost = convertToDisplayCurrency(asset.avg_cost, asset.currency);
            const converted_current_price = convertToDisplayCurrency(asset.current_price, asset.currency);
            const converted_total_cost = convertToDisplayCurrency(asset.total_cost, asset.currency);
            const converted_current_value = convertToDisplayCurrency(asset.current_value, asset.currency);
            const converted_realized_pnl = convertToDisplayCurrency(asset.realized_pnl, asset.currency);
            const converted_total_fees = convertToDisplayCurrency(asset.total_fees, asset.currency);
            const converted_unrealized_pnl = convertToDisplayCurrency(asset.unrealized_pnl, asset.currency);

            // Recalculate PnL in display currency to prevent conversion mismatches (e.g. rate missing for PnL but present for Price)
            // EXCEPTION: For TFEX and Crypto Futures, Total Cost is "Raw Cost" or "Margin" but Current Value is "Notional".
            // Subtracting them directly gives nonsense results. We must trust the Backend's PnL.
            const isFutures = asset.asset_type === 'tfex' || (asset.asset_type === 'crypto' && (asset.leverage || 1) > 1);

            const derived_unrealized_pnl = isFutures
                ? converted_unrealized_pnl
                : converted_current_value - converted_total_cost;

            return {
                ...asset,
                avg_cost: converted_avg_cost,
                current_price: converted_current_price,
                total_cost: converted_total_cost,
                current_value: converted_current_value,
                unrealized_pnl: derived_unrealized_pnl,
                realized_pnl: converted_realized_pnl,
                total_fees: converted_total_fees,
                // Keep percentage from backend as it is currency-invariant and handles leverage logic (ROE) correctly
                unrealized_pnl_percent: asset.unrealized_pnl_percent,
                currency: displayCurrency,
            };
        });
    }, [portfolio, convertToDisplayCurrency, displayCurrency, accountSymbols]);

    // Convert portfolio data to display currency (calculated from filtered assets)
    const getConvertedSummary = useCallback((): PortfolioSummaryType => {
        const filteredAssets = getConvertedAssets();

        if (filteredAssets.length === 0) {
            return {
                total_invested: 0,
                total_current_value: 0,
                total_unrealized_pnl: 0,
                total_unrealized_pnl_percent: 0,
                total_realized_pnl: 0,
                assets_count: 0,
            };
        }

        // Calculate summary from filtered assets
        const total_invested = filteredAssets.reduce((sum, asset) => sum + asset.total_cost, 0);
        const total_current_value = filteredAssets.reduce((sum, asset) => sum + asset.current_value, 0);
        const total_unrealized_pnl = filteredAssets.reduce((sum, asset) => sum + asset.unrealized_pnl, 0);
        const total_unrealized_pnl_percent = total_invested > 0
            ? (total_unrealized_pnl / total_invested) * 100
            : 0;

        // Realized PnL calculation:
        // If breakdown is available, convert each currency component and sum up
        // Otherwise fallback to simple conversion of total (legacy behavior)
        let total_realized_pnl = 0;

        if (selectedAccountId) {
            // Can't calculate per-account realized PnL from current data reliably without backend support
            total_realized_pnl = 0;
        } else if (portfolio?.summary.realized_pnl_breakdown) {
            // New logic: Sum converted components
            Object.entries(portfolio.summary.realized_pnl_breakdown).forEach(([currency, pnl]) => {
                total_realized_pnl += convertToDisplayCurrency(pnl, currency);
            });
        } else {
            // Fallback logic
            total_realized_pnl = convertToDisplayCurrency(portfolio?.summary.total_realized_pnl || 0);
        }

        return {
            total_invested,
            total_current_value,
            total_unrealized_pnl,
            total_unrealized_pnl_percent,
            total_realized_pnl,
            realized_pnl_breakdown: !selectedAccountId ? portfolio?.summary.realized_pnl_breakdown : undefined,
            assets_count: filteredAssets.length,
        };
    }, [getConvertedAssets, selectedAccountId, portfolio, convertToDisplayCurrency]);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            const [portfolioData, transactionsData] = await Promise.all([
                getPortfolio({ includeClosedPositions: showClosedPositions }),
                getTransactions(),
            ]);
            setPortfolio(portfolioData);
            setTransactions(transactionsData);
        } catch (err) {
            console.error('Failed to fetch data:', err);
            setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลได้');
        } finally {
            setIsLoading(false);
        }
    }, [showClosedPositions]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleTransactionSuccess = () => {
        setShowForm(false);
        setEditingTransaction(null);
        fetchData();
    };

    const handleDeleteTransaction = async (id: string) => {
        if (!confirm('คุณต้องการลบรายการนี้หรือไม่?')) return;
        try {
            await deleteTransaction(id);
            fetchData();
        } catch (err) {
            console.error('Failed to delete transaction:', err);
        }
    };

    const handleEditTransaction = (transaction: Transaction) => {
        setEditingTransaction(transaction);
        setShowForm(true);
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingTransaction(null);
    };

    const currencyOptions: { value: DisplayCurrency; label: string; icon: string }[] = [
        { value: 'THB', label: 'THB (บาท)', icon: '🇹🇭' },
        { value: 'USD', label: 'USD (ดอลลาร์)', icon: '🇺🇸' },
        { value: 'BTC', label: 'BTC (บิทคอยน์)', icon: '₿' },
    ];

    // Scroll to top when changing tabs, but keep state
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeTab]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Header */}
            <header className="border-b border-gray-800/50 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">Portfolio Tracker</h1>
                                <p className="text-xs text-gray-500">{t('หุ้น • TFEX • Crypto • ทองคำ', 'Stocks • TFEX • Crypto • Gold')}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Currency Selector */}
                            <div className="relative">
                                <select
                                    value={displayCurrency}
                                    onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
                                    className="appearance-none bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                                    disabled={isLoadingRates}
                                >
                                    {currencyOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.icon} {opt.value}
                                        </option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>

                            {/* Refresh button */}
                            <button
                                onClick={fetchData}
                                disabled={isLoading}
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('รีเฟรช', 'Refresh')}
                            >
                                <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>

                            {/* Transactions button */}
                            <Link
                                href="/transactions"
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('รายการซื้อขาย', 'Transactions')}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                            </Link>

                            {/* Reports button */}
                            <Link
                                href="/reports"
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('รายงาน', 'Reports')}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                            </Link>

                            {/* Analysis button */}
                            <Link
                                href="/analysis"
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('วิเคราะห์', 'Analysis')}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </Link>

                            {/* Settings button */}
                            <Link
                                href="/settings"
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('ตั้งค่า', 'Settings')}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </Link>

                            {/* Profile button */}
                            <Link
                                href="/profile"
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                                title={t('โปรไฟล์', 'Profile')}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                            </Link>
                        </div>
                    </div>
                </div>
            </header>
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* ... (Error message) ... */}
                {error && (
                    <div className="mb-6 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-lg flex items-center gap-3">
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{error}</span>
                        <button onClick={fetchData} className="ml-auto text-sm underline hover:no-underline">
                            {t('ลองใหม่', 'Retry')}
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left column - Main content */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Portfolio Summary */}
                        <section className="animate-fade-in">
                            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                {t('ภาพรวมพอร์ตโฟลิโอ', 'Portfolio Overview')}
                                <span className="text-sm text-gray-500 font-normal">({displayCurrency})</span>
                            </h2>
                            <PortfolioSummary
                                summary={getConvertedSummary()}
                                assets={getConvertedAssets()}
                                isLoading={isLoading || isLoadingRates}
                                displayCurrency={displayCurrency}
                                onMetricSelect={setSelectedMetric}
                            />
                        </section>

                        {/* Performance Chart */}
                        <section className="animate-fade-in">
                            <PerformanceChart displayCurrency={displayCurrency} />
                        </section>

                        {/* Quick Actions */}
                        <div className="flex gap-3">
                            <Link
                                href="/transactions"
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-emerald-500/25"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                {t('เพิ่มรายการซื้อขาย', 'New Transaction')}
                            </Link>
                            <Link
                                href="/reports"
                                className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-all border border-gray-600/50"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                {t('ดูรายงาน', 'View Reports')}
                            </Link>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-2 border-b border-gray-800">
                            <button
                                onClick={() => setActiveTab('portfolio')}
                                className={`px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${activeTab === 'portfolio'
                                    ? 'text-emerald-400 border-emerald-400'
                                    : 'text-gray-400 border-transparent hover:text-white'
                                    }`}
                            >
                                {t('สินทรัพย์ที่ถือ', 'Assets Held')} ({getConvertedAssets().length})
                            </button>
                            <button
                                onClick={() => setActiveTab('transactions')}
                                className={`px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${activeTab === 'transactions'
                                    ? 'text-emerald-400 border-emerald-400'
                                    : 'text-gray-400 border-transparent hover:text-white'
                                    }`}
                            >
                                {t('ประวัติการซื้อขาย', 'Transaction History')} ({filteredTransactions.length})
                            </button>

                            {/* Show Closed Positions Toggle */}
                            <label className="flex items-center gap-2 ml-auto px-3 py-2 text-sm cursor-pointer">
                                <span className="text-gray-400">{t('แสดงสินทรัพย์ที่ขายแล้ว', 'Show Closed')}</span>
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        checked={showClosedPositions}
                                        onChange={(e) => setShowClosedPositions(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 peer-checked:after:bg-white"></div>
                                </div>
                            </label>
                        </div>

                        {/* Tab content */}
                        <section className="animate-fade-in">
                            {activeTab === 'portfolio' ? (
                                <AssetList
                                    assets={getConvertedAssets()}
                                    portfolio={portfolio}
                                    isLoading={isLoading || isLoadingRates}
                                    displayCurrency={displayCurrency}
                                    convertToDisplayCurrency={convertToDisplayCurrency}
                                    onAssetSelect={setSelectedAsset}
                                />
                            ) : (
                                <TransactionList
                                    transactions={filteredTransactions}
                                    isLoading={isLoading}
                                    onDelete={handleDeleteTransaction}
                                    onEdit={handleEditTransaction}
                                    displayCurrency={displayCurrency}
                                    convertToDisplayCurrency={convertToDisplayCurrency}
                                />
                            )}
                        </section>
                    </div>

                    {/* Right column - Account Manager and Form */}
                    <div className="lg:col-span-1 space-y-6">
                        {/* Account Manager */}
                        <AccountManager
                            selectedAccountId={selectedAccountId}
                            onAccountSelect={setSelectedAccountId}
                            transactions={transactions}
                            portfolio={portfolio}
                            displayCurrency={displayCurrency}
                            exchangeRates={exchangeRates}
                        />

                        {/* Transaction Form - only show when showForm is true */}
                        {showForm && (
                            <div className="sticky top-24 hidden lg:block">
                                <TransactionForm
                                    onSuccess={handleTransactionSuccess}
                                    onClose={handleCloseForm}
                                    defaultAccountId={selectedAccountId || undefined}
                                    editTransaction={editingTransaction}
                                />
                            </div>
                        )}

                        {/* Mobile overlay */}
                        {showForm && (
                            <div
                                className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                                onClick={() => setShowForm(false)}
                            />
                        )}
                        <div className={`fixed inset-x-4 bottom-4 z-50 lg:hidden transition-all duration-300 ${showForm ? 'translate-y-0' : 'translate-y-full'}`}>
                            <TransactionForm
                                onSuccess={handleTransactionSuccess}
                                onClose={handleCloseForm}
                                defaultAccountId={selectedAccountId || undefined}
                                editTransaction={editingTransaction}
                            />
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-800/50 mt-12 py-6 pb-16">
                <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                    <p className="text-center text-gray-600 text-sm">
                        Portfolio Tracker • ราคา Crypto จาก CoinGecko • แสดงเป็น {displayCurrency}
                    </p>
                </div>
            </footer>
            <Footer />

            {/* Global Modal Layer */}
            {selectedAsset && (
                <AssetDetailsModal
                    asset={selectedAsset}
                    portfolio={portfolio ? {
                        ...portfolio,
                        assets: portfolio.assets.map(a =>
                            a.symbol === selectedAsset.symbol ? selectedAsset : a
                        )
                    } : { assets: [selectedAsset] } as any}
                    displayCurrency={displayCurrency}
                    onClose={() => setSelectedAsset(null)}
                />
            )}

            {/* Portfolio Details Modal */}
            {selectedMetric && portfolio && (
                <PortfolioDetailsModal
                    metric={selectedMetric}
                    summary={getConvertedSummary()}
                    assets={getConvertedAssets()}
                    displayCurrency={displayCurrency}
                    onClose={() => setSelectedMetric(null)}
                />
            )}
        </div>
    );
}
