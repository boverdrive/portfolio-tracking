'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Header from '@/components/Header';
import AssetTypeBreakdown from '@/components/AssetTypeBreakdown';
import AssetBreakdownModal, { BreakdownAsset } from '@/components/AssetBreakdownModal';
import { useSettings } from '@/contexts/SettingsContext';
import { getTransactions, getPortfolio, getAccounts, formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, getAllExchangeRates } from '@/lib/api';
import { Transaction, PortfolioResponse, Account } from '@/types';

import { useRouter } from 'next/navigation';

export default function AnalysisPage() {
    const router = useRouter();
    const { t, settings, displayCurrency, setDisplayCurrency } = useSettings();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
    const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);
    const [realizedBreakdownData, setRealizedBreakdownData] = useState<{ accountName: string; items: any[] } | null>(null);
    const [selectedMonthPerf, setSelectedMonthPerf] = useState<{ month: string; purchases: any[] } | null>(null);
    const [selectedMonthActivity, setSelectedMonthActivity] = useState<{ month: string; transactions: Transaction[] } | null>(null);
    const [selectedBreakdownType, setSelectedBreakdownType] = useState<string | null>(null);
    const [overviewModalState, setOverviewModalState] = useState<'assets' | 'value' | 'pnl' | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: 'month' | 'buys' | 'sells' | 'count'; direction: 'asc' | 'desc' }>({ key: 'month', direction: 'desc' });

    // Currency state
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [isLoadingRates, setIsLoadingRates] = useState(false);

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
    const isCloseAction = (action: string) => action === 'sell' || action === 'short' || action === 'close_long' || action === 'close_short' || action === 'liquidate_long' || action === 'liquidate_short';

    // Helper to convert to Base Currency (THB)
    const toBase = useCallback((amount: number, currency: string) => {
        if (currency === 'THB') return amount;
        const rate = exchangeRates[currency] || exchangeRates[currency.toUpperCase()];
        return rate ? amount / rate : amount; // Fallback to amount if rate missing (dangerous but better than 0)
    }, [exchangeRates]);

    const getTxCurrency = useCallback((tx: Transaction) => {
        // Simple heuristic or helper if available
        if (tx.currency) return tx.currency;
        if (tx.market && ['binance', 'okx'].includes(tx.market.toLowerCase())) return 'USDT';
        return 'THB';
    }, []);

    // Analysis calculations
    const analysis = useMemo(() => {
        if (!transactions.length) return null;



        // Group transactions by symbol
        const bySymbol: Record<string, { buys: number; sells: number; quantity: number; totalBuyQty: number }> = {};

        transactions.forEach(tx => {
            if (!bySymbol[tx.symbol]) {
                bySymbol[tx.symbol] = { buys: 0, sells: 0, quantity: 0, totalBuyQty: 0 };
            }

            const currency = getTxCurrency(tx);
            // Calculate Value in THB (Base)
            // Fix: Only apply multiplier for TFEX. Crypto Futures Qty is Notional.
            const multiplier = tx.asset_type === 'tfex' ? (tx.leverage || 1) : 1;
            const rawValue = tx.quantity * tx.price * multiplier;
            const value = toBase(rawValue, currency);

            if (isOpenAction(tx.action)) {
                bySymbol[tx.symbol].buys += value;
                bySymbol[tx.symbol].quantity += tx.quantity;
                bySymbol[tx.symbol].totalBuyQty += tx.quantity;
            } else if (tx.action === 'short') {
                bySymbol[tx.symbol].sells += value;
                bySymbol[tx.symbol].quantity -= tx.quantity;
            } else {
                bySymbol[tx.symbol].sells += value;
                bySymbol[tx.symbol].quantity -= tx.quantity;
            }
        });

        // Top performers
        const symbolStats = Object.entries(bySymbol).map(([symbol, data]) => {
            const asset = portfolio?.assets.find(a => a.symbol === symbol);

            // Calculate Current Value in THB (Base)
            // Apply Multiplier (Leverage) ONLY for TFEX
            const leverage = (asset && asset.asset_type === 'tfex') ? (asset.leverage || 1) : 1;
            // Note: asset.current_price is in asset.currency. Need to convert.
            const rawCurrentValue = asset ? asset.current_price * data.quantity * leverage : 0;
            const currentValue = asset ? toBase(rawCurrentValue, asset.currency) : 0;

            const unrealizedPnL = currentValue - (data.buys - data.sells);

            // Calculate cost basis for PnL %
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
        const monthlyData: Record<string, { buys: number; sells: number; count: number; transactions: Transaction[] }> = {};
        transactions.forEach(tx => {
            const month = tx.timestamp.substring(0, 7); // YYYY-MM
            if (!monthlyData[month]) {
                monthlyData[month] = { buys: 0, sells: 0, count: 0, transactions: [] };
            }
            const currency = getTxCurrency(tx);
            const multiplier = tx.asset_type === 'tfex' ? (tx.leverage || 1) : 1;
            const rawValue = tx.quantity * tx.price * multiplier;
            const value = toBase(rawValue, currency);

            if (isOpenAction(tx.action)) {
                monthlyData[month].buys += value;
            } else {
                monthlyData[month].sells += value;
            }
            monthlyData[month].count += 1;
            monthlyData[month].transactions.push(tx);
        });

        const recentMonths = Object.entries(monthlyData);

        ;

        // Monthly Purchase Performance
        const monthlyPurchasePerf: Record<string, {
            totalInvested: number;
            currentValue: number;
            purchases: { symbol: string; qty: number; cost: number; currentValue: number; date: string; assetType: string }[]
        }> = {};

        transactions.filter(tx => isOpenAction(tx.action)).forEach(tx => {
            const month = tx.timestamp.substring(0, 7);
            if (!monthlyPurchasePerf[month]) {
                monthlyPurchasePerf[month] = { totalInvested: 0, currentValue: 0, purchases: [] };
            }

            const asset = portfolio?.assets.find(a => a.symbol === tx.symbol);
            // Asset Value in THB
            // Fix: Only apply multiplier for TFEX
            const multiplier = (asset?.asset_type === 'tfex' || tx.asset_type === 'tfex') ? (tx.leverage || 1) : 1;

            const currency = getTxCurrency(tx);
            const rawCost = (tx.quantity * tx.price * multiplier) + tx.fees;
            const cost = toBase(rawCost, currency);

            const assetPrice = asset ? asset.current_price : tx.price;
            const assetCurrency = asset ? asset.currency : currency;

            const rawCurrValue = tx.quantity * assetPrice * multiplier;

            // If asset is missing, currValue uses cost (already toBase'd if we used tx.price).
            // But here we reconstruct raw.
            const currValue = toBase(rawCurrValue, assetCurrency);

            monthlyPurchasePerf[month].totalInvested += cost;
            monthlyPurchasePerf[month].currentValue += currValue;
            monthlyPurchasePerf[month].purchases.push({
                symbol: tx.symbol,
                qty: tx.quantity,
                cost,
                currentValue: currValue,
                date: tx.timestamp,
                assetType: tx.asset_type
            });
        });

        const monthlyPerformance = Object.entries(monthlyPurchasePerf)
            .map(([month, data]) => ({
                month,
                totalInvested: data.totalInvested,
                currentValue: data.currentValue,
                pnl: data.currentValue - data.totalInvested,
                pnlPercent: data.totalInvested > 0 ? ((data.currentValue - data.totalInvested) / data.totalInvested) * 100 : 0,
                purchaseCount: data.purchases.length,
                purchases: data.purchases
            }))
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12);

        // Asset type breakdown
        const byAssetType: Record<string, number> = {};
        portfolio?.assets.forEach(asset => {
            const type = asset.asset_type;
            // Value in THB
            // Fix: Only apply multiplier for TFEX
            const multiplier = asset.asset_type === 'tfex' ? (asset.leverage || 1) : 1;
            const rawValue = asset.current_price * asset.quantity * multiplier;
            // Actually Dashboard uses current_value from backend which has multiplier.
            // But here we calculate from price + qty. So we MUST apply leverage.
            const value = toBase(rawValue, asset.currency);

            byAssetType[type] = (byAssetType[type] || 0) + value;
        });

        // Asset Type Breakdown
        // Futures -> Use Initial Margin (total_cost)
        // Spot -> Use Current Value (current_value) - per user request to fix "Missing Crypto Spot" and "Wrong Stock Cost"
        const investedByAssetType: Record<string, number> = {};
        const assetsByBreakdownType: Record<string, BreakdownAsset[]> = {};

        portfolio?.assets.forEach(asset => {
            let type = asset.asset_type;
            let shouldUseMargin = false;

            // Identify Futures
            if (type === 'tfex') {
                shouldUseMargin = true;
            } else if (type === 'crypto') {
                if ((asset.leverage || 1) > 1) {
                    type = 'crypto_futures' as any;
                    shouldUseMargin = true;
                }
            }

            // Select Value Source
            let rawValue = 0;
            if (shouldUseMargin) {
                rawValue = asset.total_cost; // Margin for Futures
            } else {
                rawValue = asset.current_value; // Market Value for Spot
            }

            // Convert to Base (THB)
            const value = toBase(rawValue, asset.currency);
            investedByAssetType[type] = (investedByAssetType[type] || 0) + value;

            // Collect details for Modal
            if (!assetsByBreakdownType[type]) assetsByBreakdownType[type] = [];
            assetsByBreakdownType[type].push({
                symbol: asset.symbol,
                assetType: asset.asset_type,
                quantity: asset.quantity,
                value: value, // THB Value
                currency: asset.currency,
                displayValue: value // Placeholder, converted in UI or via helper
            });
        });

        return {
            topGainers,
            topLosers,
            largestPositions,
            recentMonths,
            monthlyPerformance,
            byAssetType,
            investedByAssetType,
            assetsByBreakdownType,
            totalAssets: portfolio?.assets.length || 0,
            totalTransactions: transactions.length
        };
    }, [transactions, portfolio, exchangeRates]);

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

            // Separate spot and futures based on action type
            const isFuturesAction = (action: string) => ['long', 'short', 'close_long', 'close_short', 'liquidate_long', 'liquidate_short'].includes(action.toLowerCase());
            const spotTxs = accountTxs.filter(tx => !isFuturesAction(tx.action)).sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                if (timeA !== timeB) return timeA - timeB;
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
            const futuresTxs = accountTxs.filter(tx => isFuturesAction(tx.action));

            // Debug: log XAG transactions
            const xagTxs = accountTxs.filter(tx => tx.symbol === 'XAG');
            if (xagTxs.length > 0) {
                console.log('XAG transactions found:', xagTxs.map(tx => ({
                    action: tx.action,
                    isFutures: isFuturesAction(tx.action),
                    quantity: tx.quantity,
                    price: tx.price,
                    leverage: tx.leverage,
                    market: tx.market,
                    asset_type: tx.asset_type
                })));
            }

            let spotRealizedPnL = 0;
            const spotRealizedHistory: any[] = [];
            const spotHoldings = new Map<string, { quantity: number; costBasis: number; assetType: string; currency: string; transactions: Transaction[] }>();

            spotTxs.forEach(tx => {
                const current = spotHoldings.get(tx.symbol) || { quantity: 0, costBasis: 0, assetType: tx.asset_type, currency: tx.currency || 'THB', transactions: [] };
                current.transactions.push(tx);

                const txCurrency = tx.currency || 'THB';

                if (tx.action === 'buy') {
                    // Cost includes fees
                    let costInTHB = tx.quantity * tx.price + tx.fees;
                    if (txCurrency !== 'THB' && exchangeRates[txCurrency]) {
                        costInTHB = costInTHB / exchangeRates[txCurrency];
                    }
                    current.quantity += tx.quantity;
                    current.costBasis += costInTHB;
                } else if (tx.action === 'sell') {
                    // Calculate Realized PnL
                    if (current.quantity > 0) {
                        // Net proceeds needs to deduct fees
                        let saleValueRaw = tx.quantity * tx.price - tx.fees;
                        let saleValueInTHB = saleValueRaw;
                        if (txCurrency !== 'THB' && exchangeRates[txCurrency]) {
                            saleValueInTHB = saleValueRaw / exchangeRates[txCurrency];
                        }

                        const soldRatio = Math.min(tx.quantity / current.quantity, 1);
                        const cogs = current.costBasis * soldRatio;

                        const pnlChunk = (saleValueInTHB - cogs);
                        spotRealizedPnL += pnlChunk;

                        spotRealizedHistory.push({
                            symbol: tx.symbol,
                            date: tx.timestamp,
                            quantity: tx.quantity,
                            sellValue: saleValueInTHB,
                            costBasis: cogs,
                            pnl: pnlChunk,
                            currency: txCurrency
                        });

                        current.costBasis *= (1 - soldRatio);
                    }
                    current.quantity -= tx.quantity;
                }
                spotHoldings.set(tx.symbol, current);
            });

            let spotValue = 0;
            let spotCostBasis = 0;
            const symbolBreakdown: { symbol: string; assetType: string; quantity: number; costBasis: number; currentValue: number; pnl: number; pnlPercent: number; transactions: Transaction[] }[] = [];

            spotHoldings.forEach((holding, symbol) => {
                if (holding.quantity <= 0) return;

                const asset = portfolio?.assets?.find(a =>
                    a.symbol === symbol &&
                    a.asset_type === holding.assetType
                );
                let currentValue = holding.costBasis;
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

                    currentValue = valueInAssetCurrency;
                    spotValue += valueInAssetCurrency;
                } else {
                    spotValue += holding.costBasis; // fallback
                }
                spotCostBasis += holding.costBasis;

                const pnl = currentValue - holding.costBasis;
                const pnlPercent = holding.costBasis > 0 ? (pnl / holding.costBasis) * 100 : 0;
                symbolBreakdown.push({
                    symbol,
                    assetType: holding.assetType,
                    quantity: holding.quantity,
                    costBasis: holding.costBasis,
                    currentValue,
                    pnl,
                    pnlPercent,
                    transactions: holding.transactions,
                });
            });

            const spotUnrealizedPnL = spotValue - spotCostBasis;

            // ========== FUTURES (TFEX) ==========
            let futuresRealizedPnL = 0;
            let futuresUnrealizedPnL = 0;

            // Group by symbol + market for accurate matching
            const futuresBySymbolMarket = new Map<string, typeof futuresTxs>();
            futuresTxs.forEach(tx => {
                const key = `${tx.symbol}:${tx.market || ''}`;
                const list = futuresBySymbolMarket.get(key) || [];
                list.push(tx);
                futuresBySymbolMarket.set(key, list);
            });

            Array.from(futuresBySymbolMarket.entries()).forEach(([key, txs]) => {
                const [symbol, market] = key.split(':');
                txs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                let symbolRealizedPnL = 0;
                let symbolUnrealizedPnL = 0;
                let totalCostBasis = 0;

                const longQueue: { quantity: number; price: number; leverage: number }[] = [];
                const shortQueue: { quantity: number; price: number; leverage: number }[] = [];

                // Determine transaction currency (assume all txs for same symbol/market share currency)
                const firstTx = txs[0];
                const txCurrency = firstTx.currency || 'THB';

                // Look up asset to check for current price and its currency
                const asset = portfolio?.assets?.find(a =>
                    a.symbol === symbol &&
                    a.asset_type === firstTx.asset_type &&
                    (market ? a.market === market : true)
                );

                // Helper to resolve currency aliases (e.g. USDT -> USD)
                const resolveCurrency = (c: string) => {
                    const upper = c.toUpperCase();
                    if (upper === 'USDT' || upper === 'USDC' || upper === 'BUSD') return 'USD';
                    return upper;
                };

                const baseCurrency = resolveCurrency(txCurrency);

                // Helper to convert value to THB
                const toThb = (amount: number, currency: string) => {
                    const code = resolveCurrency(currency);
                    if (code === 'THB') return amount;
                    // exchangeRates stores units per THB (e.g. 1 THB = 0.03 USD)
                    const rate = exchangeRates[code];
                    return rate ? amount / rate : amount;
                };

                txs.forEach(tx => {
                    // Fix: Only apply leverage multiplier for TFEX
                    const multiplier = tx.asset_type === 'tfex' ? (tx.leverage || 1) : 1;

                    if (tx.action === 'long') {
                        longQueue.push({ quantity: tx.quantity, price: tx.price, leverage: multiplier });
                        // Add cost basis converted to THB
                        totalCostBasis += toThb(tx.quantity * tx.price * multiplier, txCurrency);
                    } else if (tx.action === 'close_long' || tx.action === 'liquidate_long') {
                        let remaining = tx.quantity;
                        while (remaining > 0 && longQueue.length > 0) {
                            const entry = longQueue[0];
                            const matched = Math.min(remaining, entry.quantity);
                            // P&L in original currency
                            const pnl = (tx.price - entry.price) * matched * entry.leverage;
                            // Convert P&L to THB
                            const pnlThb = toThb(pnl, txCurrency);

                            futuresRealizedPnL += pnlThb;
                            symbolRealizedPnL += pnlThb;
                            remaining -= matched;
                            entry.quantity -= matched;
                            if (entry.quantity <= 0) longQueue.shift();
                        }
                    } else if (tx.action === 'short') {
                        shortQueue.push({ quantity: tx.quantity, price: tx.price, leverage: multiplier });
                        totalCostBasis += toThb(tx.quantity * tx.price * multiplier, txCurrency);
                    } else if (tx.action === 'close_short' || tx.action === 'liquidate_short') {
                        let remaining = tx.quantity;
                        while (remaining > 0 && shortQueue.length > 0) {
                            const entry = shortQueue[0];
                            const matched = Math.min(remaining, entry.quantity);
                            // P&L in original currency
                            const pnl = (entry.price - tx.price) * matched * entry.leverage;
                            // Convert P&L to THB
                            const pnlThb = toThb(pnl, txCurrency);

                            futuresRealizedPnL += pnlThb;
                            symbolRealizedPnL += pnlThb;
                            remaining -= matched;
                            entry.quantity -= matched;
                            if (entry.quantity <= 0) shortQueue.shift();
                        }
                    }
                });

                // Calculate unrealized P&L for open positions
                const assetCurrency = asset?.currency || 'THB';
                const currentPrice = asset?.current_price || 0;

                // Debug log for XAG
                if (symbol === 'XAG') {
                    console.log('XAG futures debug:', {
                        symbol, market,
                        txCurrency, assetCurrency,
                        currentPrice,
                        currentPriceThb: toThb(currentPrice, assetCurrency),
                        longQueue, shortQueue
                    });
                }

                let openQty = 0;

                longQueue.forEach(pos => {
                    openQty += pos.quantity;
                    if (currentPrice > 0) {
                        // We need to compare prices in same currency.
                        // Convert Entry Price to THB and Current Price to THB
                        const entryPriceThb = toThb(pos.price, txCurrency);
                        const currentPriceThb = toThb(currentPrice, assetCurrency);

                        // P&L = (Current - Entry) * Qty * Leverage
                        // This P&L will be in THB
                        const pnlThb = (currentPriceThb - entryPriceThb) * pos.quantity * pos.leverage;

                        futuresUnrealizedPnL += pnlThb;
                        symbolUnrealizedPnL += pnlThb;
                    }
                });

                shortQueue.forEach(pos => {
                    openQty -= pos.quantity; // short is negative
                    if (currentPrice > 0) {
                        const entryPriceThb = toThb(pos.price, txCurrency);
                        const currentPriceThb = toThb(currentPrice, assetCurrency);

                        const pnlThb = (entryPriceThb - currentPriceThb) * pos.quantity * pos.leverage;

                        futuresUnrealizedPnL += pnlThb;
                        symbolUnrealizedPnL += pnlThb;
                    }
                });

                // Add futures to symbolBreakdown
                const totalPnL = symbolRealizedPnL + symbolUnrealizedPnL;
                const currentValue = totalCostBasis + totalPnL;
                const pnlPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

                if (txs.length > 0) {
                    symbolBreakdown.push({
                        symbol,
                        assetType: txs[0].asset_type,
                        quantity: openQty,
                        costBasis: totalCostBasis,
                        currentValue: currentValue,
                        pnl: totalPnL,
                        pnlPercent,
                        transactions: txs,
                    });
                }
            });

            const totalValue = spotValue + futuresRealizedPnL + futuresUnrealizedPnL;
            const totalPnL = spotUnrealizedPnL + futuresRealizedPnL + futuresUnrealizedPnL;
            const goalProgress = account.target_value && account.target_value > 0
                ? (totalValue / account.target_value) * 100
                : 0;

            return {
                account,
                spotValue,
                spotRealizedPnL,
                spotUnrealizedPnL,
                spotCostBasis,
                futuresRealizedPnL,
                futuresUnrealizedPnL,
                totalValue,
                totalPnL,
                goalProgress,
                symbolBreakdown,
                spotRealizedHistory,
            };
        }).filter(a => a.spotValue !== 0 || a.futuresRealizedPnL !== 0 || a.futuresUnrealizedPnL !== 0 || a.spotRealizedPnL !== 0 || a.account.target_value);
    }, [accounts, transactions, portfolio, exchangeRates, toBase, getTxCurrency]);

    const sortedMonthlyActivity = useMemo(() => {
        if (!analysis?.recentMonths) return [];
        return [...analysis.recentMonths].sort((a, b) => {
            let comparison = 0;
            if (sortConfig.key === 'month') {
                comparison = a[0].localeCompare(b[0]);
            } else {
                const valA = (a[1] as any)[sortConfig.key] || 0;
                const valB = (b[1] as any)[sortConfig.key] || 0;
                comparison = valA - valB;
            }
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [analysis?.recentMonths, sortConfig]);

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
                onCurrencyChange={(val) => setDisplayCurrency(val as 'THB' | 'USD' | 'BTC')}
                currencyOptions={currencyOptions}
            />

            {/* Main Content */}
            <main className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {/* Overview Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div
                        onClick={() => setOverviewModalState('assets')}
                        className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/30 p-4 cursor-pointer hover:scale-[1.02] transition-transform"
                    >
                        <div className="text-blue-400 text-sm">{t('สินทรัพย์ทั้งหมด', 'Total Assets')}</div>
                        <div className="text-2xl font-bold text-white">{analysis?.totalAssets || 0}</div>
                    </div>
                    <div
                        onClick={() => router.push('/transactions')}
                        className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/30 p-4 cursor-pointer hover:scale-[1.02] transition-transform"
                    >
                        <div className="text-emerald-400 text-sm">{t('รายการทั้งหมด', 'Total Transactions')}</div>
                        <div className="text-2xl font-bold text-white">{analysis?.totalTransactions || 0}</div>
                    </div>
                    <div
                        onClick={() => setOverviewModalState('value')}
                        className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/30 p-4 cursor-pointer hover:scale-[1.02] transition-transform"
                    >
                        <div className="text-purple-400 text-sm">{t('มูลค่าพอร์ต', 'Portfolio Value')}</div>
                        <div className="text-2xl font-bold text-white">
                            {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_current_value || 0), displayCurrency)}
                        </div>
                    </div>
                    <div
                        onClick={() => setOverviewModalState('pnl')}
                        className={`bg-gradient-to-br ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0
                            ? 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30'
                            : 'from-rose-500/20 to-rose-600/10 border-rose-500/30'} rounded-xl border p-4 cursor-pointer hover:scale-[1.02] transition-transform`}>
                        <div className={`text-sm ${(portfolio?.summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t('กำไร/ขาดทุน', 'Profit/Loss')}
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {formatCurrency(convertToDisplayCurrency(portfolio?.summary.total_unrealized_pnl || 0), displayCurrency)}
                        </div>
                    </div>
                </div>

                {/* Asset Type Breakdown (Invested) */}
                {analysis && Object.keys(analysis.investedByAssetType).length > 0 && (
                    <>
                        <AssetTypeBreakdown
                            data={Object.entries(analysis.investedByAssetType).map(([type, value]) => ({
                                type,
                                value: convertToDisplayCurrency(value, 'THB'),
                                color: '' // Color handled in component
                            }))}
                            totalValue={Object.values(analysis.investedByAssetType).reduce((a, b: number) => a + convertToDisplayCurrency(b, 'THB'), 0)}
                            displayCurrency={displayCurrency}
                            onTypeSelect={setSelectedBreakdownType}
                        />
                        {selectedBreakdownType && analysis.assetsByBreakdownType?.[selectedBreakdownType] && (
                            <AssetBreakdownModal
                                title={(selectedBreakdownType === 'crypto_futures') ? (settings.language === 'th' ? 'Crypto (Futures)' : 'Crypto (Futures)') : getAssetTypeName(selectedBreakdownType as any, settings.language)}
                                type={selectedBreakdownType}
                                assets={analysis.assetsByBreakdownType[selectedBreakdownType].map(a => ({
                                    ...a,
                                    displayValue: convertToDisplayCurrency(a.value, 'THB')
                                }))}
                                displayCurrency={displayCurrency}
                                onClose={() => setSelectedBreakdownType(null)}
                            />
                        )}
                    </>
                )}

                {/* Overview Modal */}
                {overviewModalState && analysis && (
                    <AssetBreakdownModal
                        title={
                            overviewModalState === 'assets' ? t('สินทรัพย์ทั้งหมด (เรียงตามมูลค่า)', 'All Assets (by Value)') :
                                overviewModalState === 'value' ? t('มูลค่าพอร์ต (เรียงตามมูลค่า)', 'Portfolio Value (by Value)') :
                                    t('กำไร/ขาดทุน (Unrealized P&L)', 'Profit/Loss (Unrealized)')
                        }
                        type="all"
                        subtitle={overviewModalState === 'pnl' ? t('แสดงรายการตาม Unrealized P&L', 'Showing Unrealized P&L') : undefined}
                        useColorForValue={overviewModalState === 'pnl'}
                        assets={(() => {
                            if (!analysis) return [];

                            // If calculating P&L
                            if (overviewModalState === 'pnl') {
                                return Object.values(analysis.assetsByBreakdownType).flat().map(a => {
                                    // Use data from portfolio assets for updated P&L
                                    const pAsset = portfolio?.assets.find(pa => pa.symbol === a.symbol && pa.asset_type === a.assetType);
                                    const pnl = pAsset?.unrealized_pnl || 0;
                                    const pnlThb = toBase(pnl, pAsset?.currency || 'THB');
                                    return {
                                        ...a,
                                        value: pnlThb, // Override value with P&L for sorting
                                        displayValue: convertToDisplayCurrency(pnlThb, 'THB')
                                    };
                                });
                            }

                            // Default (Assets/Value)
                            return Object.values(analysis.assetsByBreakdownType).flat().map(a => ({
                                ...a,
                                displayValue: convertToDisplayCurrency(a.value, 'THB')
                            }));
                        })()}
                        displayCurrency={displayCurrency}
                        onClose={() => setOverviewModalState(null)}
                    />
                )}

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
                                        <th className="px-4 py-3 text-right text-cyan-400">{t('Spot Realized', 'Spot Realized')}</th>
                                        <th className="px-4 py-3 text-right">{t('Spot Unrealized', 'Spot Unrealized')}</th>
                                        <th className="px-4 py-3 text-right text-cyan-400">{t('Futures Realized', 'Futures Realized')}</th>
                                        <th className="px-4 py-3 text-right">{t('Futures Unrealized', 'Futures Unrealized')}</th>
                                        <th className="px-4 py-3 text-right">{t('รวม', 'Total')}</th>
                                        <th className="px-4 py-3 text-right">{t('เป้าหมาย', 'Goal')}</th>
                                        <th className="px-4 py-3 text-center">{t('Progress', 'Progress')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountAnalysis.map((item) => (
                                        <React.Fragment key={item.account.id}>
                                            <tr
                                                className="border-t border-gray-700/50 hover:bg-gray-700/20 cursor-pointer transition-colors"
                                                onClick={() => setExpandedAccountId(expandedAccountId === item.account.id ? null : item.account.id)}
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedAccountId === item.account.id ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                        </svg>
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
                                                <td
                                                    className={`px-4 py-4 text-right font-mono ${(item.spotRealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'} cursor-pointer hover:underline`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRealizedBreakdownData({
                                                            accountName: item.account.name,
                                                            items: item.spotRealizedHistory || []
                                                        });
                                                    }}
                                                >
                                                    {(item.spotRealizedPnL || 0) >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency((item.spotRealizedPnL || 0), item.account.target_currency), displayCurrency)}
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
                                            {/* Expanded Asset Breakdown */}
                                            {expandedAccountId === item.account.id && (item.symbolBreakdown?.length ?? 0) > 0 && (
                                                <tr>
                                                    <td colSpan={9} className="bg-gray-900/50 px-6 py-4">
                                                        <div className="text-sm text-gray-400 mb-3 font-medium">
                                                            📊 {t('รายละเอียดสินทรัพย์', 'Asset Breakdown')} ({item.symbolBreakdown?.length ?? 0} {t('รายการ', 'items')})
                                                        </div>
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="text-gray-500 text-xs border-b border-gray-700/50">
                                                                    <th className="text-left py-2 px-3">{t('Symbol', 'Symbol')}</th>
                                                                    <th className="text-left py-2 px-3">{t('ประเภท', 'Type')}</th>
                                                                    <th className="text-right py-2 px-3">{t('จำนวน', 'Qty')}</th>
                                                                    <th className="text-right py-2 px-3">{t('ต้นทุน', 'Cost')}</th>
                                                                    <th className="text-right py-2 px-3">{t('มูลค่าปัจจุบัน', 'Current Value')}</th>
                                                                    <th className="text-right py-2 px-3">{t('P&L', 'P&L')}</th>
                                                                    <th className="text-right py-2 px-3">%</th>
                                                                    <th className="text-right py-2 px-3">{t('รายการ', 'Txs')}</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(item.symbolBreakdown ?? []).sort((a, b) => b.currentValue - a.currentValue).map((asset) => (
                                                                    <tr key={asset.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                                                        <td className="py-2 px-3 text-white font-medium">{asset.symbol}</td>
                                                                        <td className="py-2 px-3 text-gray-400">{getAssetTypeName(asset.assetType as any, settings.language)}</td>
                                                                        <td className="py-2 px-3 text-right text-gray-300 font-mono">
                                                                            {asset.quantity < 0.01
                                                                                ? asset.quantity.toFixed(8)
                                                                                : asset.quantity < 1
                                                                                    ? asset.quantity.toFixed(6)
                                                                                    : formatNumber(asset.quantity)
                                                                            }
                                                                        </td>
                                                                        <td className="py-2 px-3 text-right text-gray-400 font-mono">
                                                                            {formatCurrency(convertToDisplayCurrency(asset.costBasis, item.account.target_currency), displayCurrency)}
                                                                        </td>
                                                                        <td className="py-2 px-3 text-right text-white font-mono">
                                                                            {formatCurrency(convertToDisplayCurrency(asset.currentValue, item.account.target_currency), displayCurrency)}
                                                                        </td>
                                                                        <td className={`py-2 px-3 text-right font-mono ${asset.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                            {asset.pnl >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(asset.pnl, item.account.target_currency), displayCurrency)}
                                                                        </td>
                                                                        <td className={`py-2 px-3 text-right font-mono ${asset.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                            {asset.pnlPercent >= 0 ? '+' : ''}{asset.pnlPercent.toFixed(2)}%
                                                                        </td>
                                                                        <td className="py-2 px-3 text-right text-gray-500">{asset.transactions.length}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                                {/* Total row */}
                                <tfoot className="bg-gray-700/40">
                                    <tr className="border-t-2 border-gray-600">
                                        <td className="px-6 py-3 text-white font-bold">{t('รวมทั้งหมด', 'Grand Total')}</td>
                                        <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + a.spotValue, 0)), displayCurrency)}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${accountAnalysis.reduce((s, a) => s + (a.spotRealizedPnL || 0), 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {accountAnalysis.reduce((s, a) => s + (a.spotRealizedPnL || 0), 0) >= 0 ? '+' : ''}
                                            {formatCurrency(convertToDisplayCurrency(accountAnalysis.reduce((s, a) => s + (a.spotRealizedPnL || 0), 0)), displayCurrency)}
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
                                        <div className="font-mono text-emerald-400">
                                            {item.unrealizedPnL > 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(item.unrealizedPnL), displayCurrency)}
                                        </div>
                                        <div className={`text-xs ${item.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {item.pnlPercent >= 0 ? '+' : ''}{item.pnlPercent.toFixed(2)}%
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
                                            {formatCurrency(convertToDisplayCurrency(item.unrealizedPnL), displayCurrency)}
                                        </div>
                                        <div className="text-xs text-rose-400">
                                            {item.pnlPercent.toFixed(2)}%
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
                {analysis?.byAssetType && Object.keys(analysis.byAssetType).length > 0 && (() => {
                    const entries = Object.entries(analysis.byAssetType);
                    const total = Object.values(analysis.byAssetType).reduce((a, b) => a + Math.abs(b), 0);
                    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

                    // Calculate pie chart segments
                    let cumulativePercent = 0;
                    const segments = entries.map(([type, value], index) => {
                        const percent = total > 0 ? (Math.abs(value) / total) * 100 : 0;
                        const startAngle = cumulativePercent * 3.6 - 90; // Convert to degrees
                        cumulativePercent += percent;
                        const endAngle = cumulativePercent * 3.6 - 90;

                        // Calculate SVG arc path
                        const startRad = (startAngle * Math.PI) / 180;
                        const endRad = (endAngle * Math.PI) / 180;
                        const x1 = 50 + 40 * Math.cos(startRad);
                        const y1 = 50 + 40 * Math.sin(startRad);
                        const x2 = 50 + 40 * Math.cos(endRad);
                        const y2 = 50 + 40 * Math.sin(endRad);
                        const largeArc = percent > 50 ? 1 : 0;

                        return {
                            type,
                            value,
                            percent,
                            color: colors[index % colors.length],
                            path: percent >= 100
                                ? `M 50 10 A 40 40 0 1 1 49.99 10 Z`
                                : `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`
                        };
                    });

                    return (
                        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-700/50">
                                <h2 className="text-lg font-semibold text-white">📊 {t('สัดส่วนประเภทสินทรัพย์', 'Asset Type Breakdown')}</h2>
                            </div>
                            <div className="p-6">
                                <div className="flex flex-col lg:flex-row gap-6 items-center">
                                    {/* Pie Chart */}
                                    <div className="flex-shrink-0">
                                        <svg viewBox="0 0 100 100" className="w-48 h-48">
                                            {segments.map((seg, i) => (
                                                <path
                                                    key={seg.type}
                                                    d={seg.path}
                                                    fill={seg.color}
                                                    stroke="#1f2937"
                                                    strokeWidth="0.5"
                                                    className="transition-opacity hover:opacity-80 cursor-pointer"
                                                    onClick={() => setSelectedAssetType(seg.type)}
                                                />
                                            ))}
                                            {/* Center hole for donut effect */}
                                            <circle cx="50" cy="50" r="25" fill="#1f2937" />
                                            <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="fill-white text-[8px] font-bold">
                                                {formatCurrency(convertToDisplayCurrency(total), displayCurrency)}
                                            </text>
                                        </svg>
                                    </div>

                                    {/* Legend and Cards */}
                                    <div className="flex-1 w-full">
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {segments.map((seg) => (
                                                <div
                                                    key={seg.type}
                                                    className="bg-gray-700/30 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-700/50 transition-colors"
                                                    onClick={() => setSelectedAssetType(seg.type)}
                                                >
                                                    <div
                                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: seg.color }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-gray-400 text-xs truncate">{getAssetTypeName(seg.type as any, settings.language)}</div>
                                                        <div className="text-white font-bold text-sm">{seg.percent.toFixed(1)}%</div>
                                                        <div className="text-xs text-gray-500 truncate">
                                                            {formatCurrency(convertToDisplayCurrency(seg.value), displayCurrency)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

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
                                        <tr
                                            key={perf.month}
                                            className="border-t border-gray-700/50 hover:bg-gray-700/20 cursor-pointer transition-colors"
                                            onClick={() => setSelectedMonthPerf({ month: perf.month, purchases: perf.purchases })}
                                        >
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
                                        <th className="px-6 py-3 text-left cursor-pointer hover:text-white select-none" onClick={() => setSortConfig(c => ({ key: 'month', direction: c.key === 'month' && c.direction === 'asc' ? 'desc' : 'asc' }))}>
                                            <div className="flex items-center gap-2">
                                                {t('เดือน', 'Month')}
                                                {sortConfig.key === 'month' && <span className="text-xs">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>}
                                            </div>
                                        </th>
                                        <th className="px-6 py-3 text-right cursor-pointer hover:text-white select-none" onClick={() => setSortConfig(c => ({ key: 'buys', direction: c.key === 'buys' && c.direction === 'desc' ? 'asc' : 'desc' }))}>
                                            <div className="flex items-center justify-end gap-2">
                                                {t('ซื้อ', 'Buys')}
                                                {sortConfig.key === 'buys' && <span className="text-xs">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>}
                                            </div>
                                        </th>
                                        <th className="px-6 py-3 text-right cursor-pointer hover:text-white select-none" onClick={() => setSortConfig(c => ({ key: 'sells', direction: c.key === 'sells' && c.direction === 'desc' ? 'asc' : 'desc' }))}>
                                            <div className="flex items-center justify-end gap-2">
                                                {t('ขาย', 'Sells')}
                                                {sortConfig.key === 'sells' && <span className="text-xs">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>}
                                            </div>
                                        </th>
                                        <th className="px-6 py-3 text-right cursor-pointer hover:text-white select-none" onClick={() => setSortConfig(c => ({ key: 'count', direction: c.key === 'count' && c.direction === 'desc' ? 'asc' : 'desc' }))}>
                                            <div className="flex items-center justify-end gap-2">
                                                {t('รายการ', 'Count')}
                                                {sortConfig.key === 'count' && <span className="text-xs">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>}
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedMonthlyActivity.map(([month, data]) => (
                                        <tr key={month} className="border-t border-gray-700/50 hover:bg-gray-700/20 cursor-pointer transition-colors"
                                            onClick={() => setSelectedMonthActivity({ month, transactions: data.transactions })}
                                        >
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
            {/* Asset Type Details Modal */}
            {selectedAssetType && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedAssetType(null)}>
                    <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">
                                {t('รายละเอียด', 'Details')}: {getAssetTypeName(selectedAssetType as any, settings.language)}
                            </h3>
                            <button onClick={() => setSelectedAssetType(null)} className="text-gray-400 hover:text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800/50 text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2 text-left">{t('สินทรัพย์', 'Asset')}</th>
                                            <th className="px-4 py-2 text-right">{t('จำนวน', 'Qty')}</th>
                                            <th className="px-4 py-2 text-right">{t('ราคา', 'Price')}</th>
                                            <th className="px-4 py-2 text-right">{t('ตัวคูณ', 'Multiplier')}</th>
                                            <th className="px-4 py-2 text-right">{t('มูลค่าดิบ', 'Raw Value')}</th>
                                            <th className="px-4 py-2 text-right">{t('อัตราแลกเปลี่ยน', 'Exch. Rate')}</th>
                                            <th className="px-4 py-2 text-right text-white">{t('มูลค่า', 'Value')} ({displayCurrency})</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700/30">
                                        {portfolio?.assets.filter(a => a.asset_type === selectedAssetType).map((asset, index) => {
                                            const multiplier = asset.asset_type === 'tfex' ? (asset.leverage || 1) : 1;
                                            const rawValue = asset.quantity * asset.current_price * multiplier;

                                            // Calculate THB Value manually to show rate
                                            let valueInThb = rawValue;
                                            let rate = 1;
                                            let currency = asset.currency || 'THB';
                                            if (currency === 'USDT' || currency === 'USDC') currency = 'USD';

                                            if (currency !== 'THB' && exchangeRates[currency]) {
                                                rate = exchangeRates[currency];
                                                valueInThb = rawValue / rate;
                                            }

                                            return (
                                                <tr key={`${asset.symbol}-${index}`} className="hover:bg-gray-800/30">
                                                    <td className="px-4 py-3 font-medium text-white">
                                                        {asset.symbol} <span className="text-gray-500 text-xs ml-1">{asset.market}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatNumber(asset.quantity)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatNumber(asset.current_price)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-400 font-mono">
                                                        {multiplier > 1 ? `x${multiplier}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-400 font-mono">
                                                        {formatNumber(rawValue)} {asset.currency}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-400 font-mono">
                                                        {currency !== 'THB' ? rate.toFixed(2) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                                        {formatCurrency(convertToDisplayCurrency(valueInThb), displayCurrency)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {portfolio?.assets.filter(a => a.asset_type === selectedAssetType).length === 0 && (
                                            <tr><td colSpan={7} className="text-center py-4 text-gray-500">No assets found</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Realized PnL Breakdown Modal */}
            {realizedBreakdownData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setRealizedBreakdownData(null)}>
                    <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">
                                {t('รายละเอียด Spot Realized PnL', 'Spot Realized PnL Breakdown')} - {realizedBreakdownData.accountName}
                            </h3>
                            <button onClick={() => setRealizedBreakdownData(null)} className="text-gray-400 hover:text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800/50 text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2 text-left">{t('วันที่', 'Date')}</th>
                                            <th className="px-4 py-2 text-left">{t('Symbol', 'Symbol')}</th>
                                            <th className="px-4 py-2 text-right">{t('จำนวนที่ขาย', 'Sold Qty')}</th>
                                            <th className="px-4 py-2 text-right">{t('มูลค่าขาย (THB)', 'Sale Value (THB)')}</th>
                                            <th className="px-4 py-2 text-right">{t('ต้นทุน (THB)', 'Cost Basis (THB)')}</th>
                                            <th className="px-4 py-2 text-right">{t('กำไร/ขาดทุน', 'Realized PnL')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700/30">
                                        {realizedBreakdownData.items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((item, idx) => (
                                            <tr key={idx} className="hover:bg-gray-800/30">
                                                <td className="px-4 py-3 text-gray-400">
                                                    {new Date(item.date).toLocaleDateString(settings.language === 'th' ? 'th-TH' : 'en-US', {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </td>
                                                <td className="px-4 py-3 font-medium text-white">{item.symbol}</td>
                                                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                    {formatNumber(item.quantity)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                    {formatCurrency(convertToDisplayCurrency(item.sellValue), displayCurrency)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-400 font-mono">
                                                    {formatCurrency(convertToDisplayCurrency(item.costBasis), displayCurrency)}
                                                </td>
                                                <td className={`px-4 py-3 text-right font-bold font-mono ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {item.pnl >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(item.pnl), displayCurrency)}
                                                </td>
                                            </tr>
                                        ))}
                                        {realizedBreakdownData.items.length === 0 && (
                                            <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('ไม่มีรายการ', 'No records found')}</td></tr>
                                        )}
                                    </tbody>
                                    <tfoot className="bg-gray-800/50 border-t border-gray-700">
                                        <tr>
                                            <td colSpan={5} className="px-4 py-3 text-right text-white font-bold">{t('รวม', 'Total')}</td>
                                            <td className={`px-4 py-3 text-right font-bold font-mono ${realizedBreakdownData.items.reduce((sum, i) => sum + i.pnl, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {realizedBreakdownData.items.reduce((sum, i) => sum + i.pnl, 0) >= 0 ? '+' : ''}
                                                {formatCurrency(convertToDisplayCurrency(realizedBreakdownData.items.reduce((sum, i) => sum + i.pnl, 0)), displayCurrency)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Monthly Performance Details Modal */}
            {selectedMonthPerf && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedMonthPerf(null)}>
                    <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">
                                {t('รายละเอียดการซื้อ', 'Purchase Details')} - {selectedMonthPerf.month}
                            </h3>
                            <button onClick={() => setSelectedMonthPerf(null)} className="text-gray-400 hover:text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800/50 text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2 text-left">{t('วันที่', 'Date')}</th>
                                            <th className="px-4 py-2 text-left">{t('Symbol', 'Symbol')}</th>
                                            <th className="px-4 py-2 text-right">{t('จำนวน', 'Qty')}</th>
                                            <th className="px-4 py-2 text-right">{t('ต้นทุน (THB)', 'Cost (THB)')}</th>
                                            <th className="px-4 py-2 text-right">{t('มูลค่าปัจจุบัน', 'Current Value')}</th>
                                            <th className="px-4 py-2 text-right text-cyan-400">{t('กำไร/ขาดทุน', 'P&L')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700/30">
                                        {selectedMonthPerf.purchases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((item, idx) => {
                                            const pnl = item.currentValue - item.cost;
                                            return (
                                                <tr key={idx} className="hover:bg-gray-800/30">
                                                    <td className="px-4 py-3 text-gray-400">
                                                        {new Date(item.date).toLocaleDateString(settings.language === 'th' ? 'th-TH' : 'en-US', {
                                                            year: 'numeric',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-white">
                                                        {item.symbol}
                                                        <span className="text-xs text-gray-500 ml-2 border border-gray-700 rounded px-1">{getAssetTypeName(item.assetType as any, settings.language)}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatNumber(item.qty)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatCurrency(convertToDisplayCurrency(item.cost), displayCurrency)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-400 font-mono">
                                                        {formatCurrency(convertToDisplayCurrency(item.currentValue), displayCurrency)}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-bold font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {pnl >= 0 ? '+' : ''}{formatCurrency(convertToDisplayCurrency(pnl), displayCurrency)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {selectedMonthPerf.purchases.length === 0 && (
                                            <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('ไม่มีรายการ', 'No records found')}</td></tr>
                                        )}
                                    </tbody>
                                    <tfoot className="bg-gray-800/50 border-t border-gray-700">
                                        <tr>
                                            <td colSpan={3} className="px-4 py-3 text-right text-white font-bold">{t('รวม', 'Total')}</td>
                                            <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                                {formatCurrency(convertToDisplayCurrency(selectedMonthPerf.purchases.reduce((sum, i) => sum + i.cost, 0)), displayCurrency)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                                {formatCurrency(convertToDisplayCurrency(selectedMonthPerf.purchases.reduce((sum, i) => sum + i.currentValue, 0)), displayCurrency)}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-bold font-mono ${selectedMonthPerf.purchases.reduce((sum, i) => sum + (i.currentValue - i.cost), 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {selectedMonthPerf.purchases.reduce((sum, i) => sum + (i.currentValue - i.cost), 0) >= 0 ? '+' : ''}
                                                {formatCurrency(convertToDisplayCurrency(selectedMonthPerf.purchases.reduce((sum, i) => sum + (i.currentValue - i.cost), 0)), displayCurrency)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Monthly Activity Details Modal */}
            {selectedMonthActivity && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedMonthActivity(null)}>
                    <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">
                                {t('รายละเอียดกิจกรรม', 'Activity Details')} - {selectedMonthActivity.month}
                            </h3>
                            <button onClick={() => setSelectedMonthActivity(null)} className="text-gray-400 hover:text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800/50 text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2 text-left">{t('วันที่', 'Date')}</th>
                                            <th className="px-4 py-2 text-left">{t('รายการ', 'Action')}</th>
                                            <th className="px-4 py-2 text-left">{t('Symbol', 'Symbol')}</th>
                                            <th className="px-4 py-2 text-right">{t('จำนวน', 'Qty')}</th>
                                            <th className="px-4 py-2 text-right">{t('ราคา', 'Price')}</th>
                                            <th className="px-4 py-2 text-right text-white">{t('มูลค่า', 'Value')} ({displayCurrency})</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700/30">
                                        {selectedMonthActivity.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((tx, idx) => {
                                            const currency = getTxCurrency(tx);
                                            const multiplier = tx.asset_type === 'tfex' ? (tx.leverage || 1) : 1;
                                            const rawValue = tx.quantity * tx.price * multiplier;
                                            const valueInThb = toBase(rawValue, currency);
                                            const isBuy = isOpenAction(tx.action);

                                            // Determine action label and color
                                            let actionLabel = tx.action.toUpperCase();
                                            let actionColor = 'text-gray-400';
                                            if (tx.action === 'buy' || tx.action === 'long') {
                                                actionColor = 'text-emerald-400';
                                            } else if (tx.action === 'sell' || tx.action === 'short') {
                                                actionColor = 'text-rose-400';
                                            }

                                            return (
                                                <tr key={idx} className="hover:bg-gray-800/30">
                                                    <td className="px-4 py-3 text-gray-400">
                                                        {new Date(tx.timestamp).toLocaleDateString(settings.language === 'th' ? 'th-TH' : 'en-US', {
                                                            year: 'numeric',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </td>
                                                    <td className={`px-4 py-3 font-medium ${actionColor}`}>
                                                        {actionLabel}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-white">
                                                        {tx.symbol}
                                                        <span className="text-xs text-gray-500 ml-2 border border-gray-700 rounded px-1">{getAssetTypeName(tx.asset_type as any, settings.language)}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatNumber(tx.quantity)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-300 font-mono">
                                                        {formatNumber(tx.price)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-white font-bold font-mono">
                                                        {formatCurrency(convertToDisplayCurrency(valueInThb), displayCurrency)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {selectedMonthActivity.transactions.length === 0 && (
                                            <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('ไม่มีรายการ', 'No records found')}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
