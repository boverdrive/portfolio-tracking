'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import TransactionForm from '@/components/TransactionForm';
import TransactionList from '@/components/TransactionList';
import Header from '@/components/Header';
import { useSettings } from '@/contexts/SettingsContext';
import { getTransactions, getPortfolio, deleteTransaction, getAssetTypeName, getAllExchangeRates, DisplayCurrency } from '@/lib/api';
import { Transaction, AssetType, TradeAction, PortfolioResponse } from '@/types';

export default function TransactionsPage() {
    const { t, settings, displayCurrency, setDisplayCurrency } = useSettings();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Currency state
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [isLoadingRates, setIsLoadingRates] = useState(false);

    const currencyOptions = [
        { value: 'THB' as const, icon: '🇹🇭' },
        { value: 'USD' as const, icon: '🇺🇸' },
        { value: 'BTC' as const, icon: '₿' },
    ];

    // Filter states
    const [filterSymbol, setFilterSymbol] = useState('');
    const [filterAssetType, setFilterAssetType] = useState<AssetType | ''>('');
    const [filterAction, setFilterAction] = useState<TradeAction | ''>('');
    const [filterTag, setFilterTag] = useState('');

    // Fetch transactions & portfolio
    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
            const [txData, portfolioData, pricesResponse] = await Promise.all([
                getTransactions(),
                getPortfolio(),
                fetch(`${pbUrl}/api/collections/asset_prices/records?perPage=500`).then(r => r.json())
            ]);
            setTransactions(txData);
            // Attach assetPrices to portfolio for fallback P&L calculation
            if (portfolioData) {
                (portfolioData as any).assetPrices = pricesResponse.items || [];
            }
            setPortfolio(portfolioData);
            setError(null);
        } catch (err) {
            setError(t('โหลดข้อมูลไม่สำเร็จ', 'Failed to load data'));
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    }, [t]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Fetch exchange rates when currency changes
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

    // Get all unique tags
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        transactions.forEach(tx => {
            (tx.tags || []).forEach(tag => tagSet.add(tag));
        });
        return Array.from(tagSet).sort();
    }, [transactions]);

    // Filtered transactions
    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            if (filterSymbol && !tx.symbol.toLowerCase().includes(filterSymbol.toLowerCase())) {
                return false;
            }
            if (filterAssetType && tx.asset_type !== filterAssetType) {
                return false;
            }
            if (filterAction && tx.action !== filterAction) {
                return false;
            }
            if (filterTag && !(tx.tags || []).includes(filterTag)) {
                return false;
            }
            return true;
        });
    }, [transactions, filterSymbol, filterAssetType, filterAction, filterTag]);

    // Handle transaction delete
    const handleDelete = async (id: string) => {
        if (window.confirm(t('ต้องการลบรายการนี้หรือไม่?', 'Are you sure you want to delete this transaction?'))) {
            try {
                await deleteTransaction(id);
                fetchData();
            } catch (err) {
                setError(t('ลบรายการไม่สำเร็จ', 'Failed to delete transaction'));
            }
        }
    };

    // Handle transaction edit
    const handleEdit = (transaction: Transaction) => {
        setEditingTransaction(transaction);
        setShowForm(true);
    };

    // Handle form success
    const handleFormSuccess = () => {
        setShowForm(false);
        setEditingTransaction(null);
        fetchData();
    };

    // Handle form close
    const handleFormClose = () => {
        setShowForm(false);
        setEditingTransaction(null);
    };

    // Clear all filters
    const clearFilters = () => {
        setFilterSymbol('');
        setFilterAssetType('');
        setFilterAction('');
        setFilterTag('');
    };

    const hasActiveFilters = filterSymbol || filterAssetType || filterAction || filterTag;

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Top Navigation Bar */}
            <Header
                currentPage="transactions"
                showCurrencySelector={true}
                currencyValue={displayCurrency}
                onCurrencyChange={(val) => setDisplayCurrency(val as 'THB' | 'USD' | 'BTC')}
                currencyOptions={currencyOptions}
            />

            {/* Main Content */}
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Error message */}
                {error && (
                    <div className="mb-6 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-lg flex items-center gap-3">
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {error}
                        <button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-300">
                            ×
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Transaction Form - Collapsible in left column when open */}
                    {showForm && (
                        <div className="lg:col-span-1">
                            <TransactionForm
                                editTransaction={editingTransaction}
                                onSuccess={handleFormSuccess}
                                onClose={handleFormClose}
                            />
                        </div>
                    )}

                    {/* Transaction List */}
                    <div className={showForm ? "lg:col-span-2" : "lg:col-span-3"}>
                        <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden shadow-xl">
                            {/* Widget Header with Add Button */}
                            <div className="px-6 py-4 border-b border-gray-700/50">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-semibold text-white">
                                        📋 {t('ประวัติการซื้อขาย', 'Transaction History')}
                                    </h2>
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-500 text-sm">
                                            {filteredTransactions.length} / {transactions.length} {t('รายการ', 'transactions')}
                                        </span>
                                        <button
                                            onClick={() => {
                                                setEditingTransaction(null);
                                                setShowForm(!showForm);
                                            }}
                                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-emerald-500/25"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                            </svg>
                                            {t('เพิ่มรายการ', 'Add Transaction')}
                                        </button>
                                    </div>
                                </div>

                                {/* Filters */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {/* Symbol Filter */}
                                    <div>
                                        <input
                                            type="text"
                                            value={filterSymbol}
                                            onChange={(e) => setFilterSymbol(e.target.value)}
                                            placeholder={t('ค้นหาสัญลักษณ์...', 'Search symbol...')}
                                            className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        />
                                    </div>

                                    {/* Asset Type Filter */}
                                    <div>
                                        <select
                                            value={filterAssetType}
                                            onChange={(e) => setFilterAssetType(e.target.value as AssetType | '')}
                                            className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        >
                                            <option value="">{t('ทุกประเภท', 'All Types')}</option>
                                            <option value="stock">{getAssetTypeName('stock', settings.language)}</option>
                                            <option value="crypto">{getAssetTypeName('crypto', settings.language)}</option>
                                            <option value="gold">{getAssetTypeName('gold', settings.language)}</option>
                                            <option value="foreign_stock">{getAssetTypeName('foreign_stock', settings.language)}</option>
                                            <option value="tfex">{getAssetTypeName('tfex', settings.language)}</option>
                                            <option value="commodity">{getAssetTypeName('commodity', settings.language)}</option>
                                        </select>
                                    </div>

                                    {/* Action Filter */}
                                    <div>
                                        <select
                                            value={filterAction}
                                            onChange={(e) => setFilterAction(e.target.value as TradeAction | '')}
                                            className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        >
                                            <option value="">{t('ทุกการกระทำ', 'All Actions')}</option>
                                            <option value="buy">{t('ซื้อ', 'Buy')}</option>
                                            <option value="sell">{t('ขาย', 'Sell')}</option>
                                            <option value="long">Long</option>
                                            <option value="short">Short</option>
                                            <option value="close_long">{t('ปิด Long', 'Close Long')}</option>
                                            <option value="close_short">{t('ปิด Short', 'Close Short')}</option>
                                        </select>
                                    </div>

                                    {/* Tag Filter */}
                                    <div className="flex gap-2">
                                        <select
                                            value={filterTag}
                                            onChange={(e) => setFilterTag(e.target.value)}
                                            className="flex-1 px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        >
                                            <option value="">{t('ทุกแท็ก', 'All Tags')}</option>
                                            {allTags.map(tag => (
                                                <option key={tag} value={tag}>{tag}</option>
                                            ))}
                                        </select>
                                        {hasActiveFilters && (
                                            <button
                                                onClick={clearFilters}
                                                className="px-3 py-2 bg-rose-500/20 text-rose-400 rounded-lg hover:bg-rose-500/30 transition-all text-sm"
                                                title={t('ล้างตัวกรอง', 'Clear filters')}
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <TransactionList
                                transactions={filteredTransactions}
                                portfolio={portfolio}
                                isLoading={isLoading || isLoadingRates}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                displayCurrency={displayCurrency}
                                convertToDisplayCurrency={convertToDisplayCurrency}
                            />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
