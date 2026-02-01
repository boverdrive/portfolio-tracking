'use client';

import { useEffect, useState, useMemo } from 'react';
import { PortfolioAsset, Transaction, PortfolioResponse } from '@/types';
import { useSettings } from '@/contexts/SettingsContext';
import { getTransactions, formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, getAllExchangeRates, getMarketName, getEffectiveCurrency } from '@/lib/api';
import { getUnitConversionFactor } from '@/lib/units';
import AssetLogo from '@/components/AssetLogo';
import TransactionList from '@/components/TransactionList';

interface Props {
    asset: PortfolioAsset;
    portfolio?: PortfolioResponse | null;
    displayCurrency?: DisplayCurrency;

    onClose: () => void;
    onAddDividend?: (asset: PortfolioAsset) => void;
}

export default function AssetDetailsModal({ asset, portfolio, displayCurrency = 'THB', onClose, onAddDividend }: Props) {
    const { t, settings } = useSettings();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

    useEffect(() => {
        const loadData = async () => {
            // 1. Fetch Rates
            try {
                const ratesData = await getAllExchangeRates(settings.defaultCurrency);
                setExchangeRates(ratesData.rates);
            } catch (e) {
                console.error("Failed to load rates", e);
            }

            // 2. Fetch Transactions
            try {
                const allTransactions = await getTransactions();
                const assetTransactions = allTransactions
                    .filter(tx =>
                        tx.symbol === asset.symbol &&
                        tx.asset_type === asset.asset_type &&
                        tx.market === asset.market &&
                        // Filtering by position type (Hedge Mode support)
                        (
                            asset.position_type === 'short' ? (tx.action === 'short' || tx.action === 'close_short') :
                                asset.position_type === 'long' ? (tx.action === 'long' || tx.action === 'close_long') :
                                    // For spot or legacy, include buy/sell and legacy/mixed types if strictly not long/short bucket
                                    (tx.action === 'buy' || tx.action === 'sell' || tx.action === 'dividend')
                        )
                    )
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                setTransactions(assetTransactions);
            } catch (error) {
                console.error('Failed to fetch transactions:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [asset.symbol, asset.asset_type, settings.defaultCurrency, asset.position_type]);



    // Calculate per-transaction metrics (Realized/Unrealized P&L) using FIFO
    const transactionMetrics = useMemo(() => {
        if (!asset || Object.keys(exchangeRates).length === 0) return {};

        // Helper to convert any amount from 'fromCurr' to 'toCurr'
        const convert = (amount: number, from: string, to: string) => {
            let fromCurr = from.toUpperCase();
            if (['USDT', 'USDC', 'BUSD', 'DAI'].includes(fromCurr)) fromCurr = 'USD';

            const toCurr = to.toUpperCase();
            if (fromCurr === toCurr) return amount;

            const base = settings.defaultCurrency;

            // 1. To Base
            let valInBase = amount;
            if (fromCurr !== base) {
                const r = exchangeRates[fromCurr];
                if (!r) return amount;
                valInBase = amount / r;
            }

            // 2. To Target
            if (toCurr === base) return valInBase;
            const rToc = exchangeRates[toCurr];
            return rToc ? valInBase * rToc : valInBase;
        };

        const sorted = [...transactions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const metrics: Record<string, { realizedPnl?: number; unrealizedPnl?: number; remainingQty?: number }> = {};
        const holdingsQueue: { qty: number; price: number; id: string }[] = [];

        sorted.forEach(tx => {
            // Apply leverage only for TFEX (Contract Size). Crypto Futures Qty = Position Size.
            const multiplier = asset.asset_type === 'tfex' ? (tx.leverage || 1) : 1;
            const txCurrency = getEffectiveCurrency(tx, settings.defaultCurrency);

            // Normalize transaction price to Asset's currency for FIFO matching
            const targetAssetCurrency = asset.currency || 'USD';

            // Apply unit conversion correction
            const conversionFactor = getUnitConversionFactor(tx.unit, asset.asset_type, targetAssetCurrency);
            const quantity = tx.quantity * conversionFactor;

            const priceInAssetCurr = convert(tx.price, txCurrency, targetAssetCurrency);
            const currentPrice = asset.current_price || 0;

            // Helper to convert PnL Result from AssetCurrency to BaseCurrency (THB) for storage
            const toBasePnl = (pnlInAssetCurr: number) => convert(pnlInAssetCurr, targetAssetCurrency, settings.defaultCurrency);

            if (tx.action === 'buy' || tx.action === 'long') {
                holdingsQueue.push({ qty: quantity, price: priceInAssetCurr, id: tx.id });
                metrics[tx.id] = {
                    remainingQty: quantity,
                    unrealizedPnl: toBasePnl((currentPrice - priceInAssetCurr) * quantity * multiplier)
                };
            }
            else if (tx.action === 'short') {
                holdingsQueue.push({ qty: quantity, price: priceInAssetCurr, id: tx.id });
                metrics[tx.id] = {
                    remainingQty: quantity,
                    unrealizedPnl: toBasePnl((priceInAssetCurr - currentPrice) * quantity * multiplier)
                };
            }
            else if (tx.action === 'sell' || tx.action === 'close_long') {
                let remainingToSell = quantity;
                let totalRealizedPnlAssetCurr = 0;

                while (remainingToSell > 0 && holdingsQueue.length > 0) {
                    const item = holdingsQueue[0];
                    const take = Math.min(remainingToSell, item.qty);
                    const pnlChunk = (priceInAssetCurr - item.price) * take * multiplier;
                    totalRealizedPnlAssetCurr += pnlChunk;

                    item.qty -= take;
                    remainingToSell -= take;

                    const buyMetrics = metrics[item.id];
                    if (buyMetrics) {
                        buyMetrics.remainingQty = item.qty;
                        buyMetrics.unrealizedPnl = toBasePnl((currentPrice - item.price) * item.qty * multiplier);
                    }
                    if (item.qty <= 0) holdingsQueue.shift();
                }
                metrics[tx.id] = { realizedPnl: toBasePnl(totalRealizedPnlAssetCurr) };
            }
            else if (tx.action === 'close_short') {
                let remainingToCover = quantity;
                let totalRealizedPnlAssetCurr = 0;

                while (remainingToCover > 0 && holdingsQueue.length > 0) {
                    const item = holdingsQueue[0];
                    const take = Math.min(remainingToCover, item.qty);
                    const pnlChunk = (item.price - priceInAssetCurr) * take * multiplier;
                    totalRealizedPnlAssetCurr += pnlChunk;

                    item.qty -= take;
                    remainingToCover -= take;

                    const shortMetrics = metrics[item.id];
                    if (shortMetrics) {
                        shortMetrics.remainingQty = item.qty;
                        shortMetrics.unrealizedPnl = toBasePnl((item.price - currentPrice) * item.qty * multiplier);
                    }
                    if (item.qty <= 0) holdingsQueue.shift();
                }
                metrics[tx.id] = { realizedPnl: toBasePnl(totalRealizedPnlAssetCurr) };
            }
        });

        return metrics;
    }, [transactions, asset.current_price, asset.currency, exchangeRates, settings.defaultCurrency, asset.asset_type]);

    const formatValue = (value: number) => {
        if (displayCurrency === 'BTC') {
            return `₿ ${value.toFixed(8)}`;
        }
        return formatCurrency(value, displayCurrency);
    };

    const convertToDisplayCurrency = (value: number, fromCurrency: string = 'THB'): number => {
        if (displayCurrency === fromCurrency) return value;

        let fromCurr = fromCurrency ? fromCurrency.toUpperCase() : 'THB';
        if (['USDT', 'USDC', 'BUSD', 'DAI'].includes(fromCurr)) fromCurr = 'USD';

        let valueInBase = value;
        if (fromCurr !== settings.defaultCurrency) {
            const rate = exchangeRates[fromCurr];
            if (rate) valueInBase = value / rate;
        }

        if (displayCurrency === settings.defaultCurrency) return valueInBase;
        const rateToDisplay = exchangeRates[displayCurrency];
        return rateToDisplay ? valueInBase * rateToDisplay : valueInBase;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-800 bg-gray-800/30 flex items-center justify-between sticky top-0 backdrop-blur-md z-10">
                    <div className="flex items-center gap-4">
                        <AssetLogo symbol={asset.symbol} assetType={asset.asset_type} size="lg" />
                        <div>
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                {asset.symbol}
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                                        {getAssetTypeName(asset.asset_type, settings.language)}
                                    </span>
                                    {asset.market && (
                                        <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                            {getMarketName(asset.market, settings.language)}
                                        </span>
                                    )}
                                </div>
                            </h2>
                            <p className="text-gray-400 text-sm">
                                {t('ราคาปัจจุบัน', 'Current Price')}: <span className="text-white font-mono">{formatValue(asset.current_price)}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {onAddDividend && (
                            <button
                                onClick={() => onAddDividend(asset)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-all text-sm font-medium"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                {t('รับปันผล', 'Add Dividend')}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700/30">
                            <div className="text-sm text-gray-400 mb-1">{t('จำนวนที่ถือครอง', 'Quantity')}</div>
                            <div className="text-xl font-mono text-white">
                                {formatNumber(asset.quantity, asset.asset_type === 'crypto' ? 8 : 2)}
                                {asset.unit && <span className="text-gray-500 text-sm ml-1.5">{asset.unit}</span>}
                            </div>
                        </div>
                        <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700/30">
                            <div className="text-sm text-gray-400 mb-1">{t('มูลค่ารวม', 'Total Value')}</div>
                            <div className="text-xl font-mono text-white">
                                {formatValue(
                                    asset.quantity * asset.current_price * (asset.asset_type === 'tfex' ? (asset.leverage || 1) : 1)
                                )}
                            </div>
                        </div>
                        <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700/30">
                            <div className="text-sm text-gray-400 mb-1">{t('ต้นทุนเฉลี่ย', 'Avg Cost')}</div>
                            <div className="text-xl font-mono text-white">
                                {formatValue(asset.avg_cost)}
                            </div>
                        </div>
                        <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700/30">
                            <div className="text-sm text-gray-400 mb-1">{t('ปันผลรวม', 'Total Dividend')}</div>
                            <div className="text-xl font-mono text-emerald-400">
                                +{formatCurrency(convertToDisplayCurrency(asset.realized_dividend || 0, asset.currency), displayCurrency)}
                            </div>
                        </div>
                        <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700/30">
                            <div className="text-sm text-gray-400 mb-1">{t('กำไร/ขาดทุนสะสม', 'Net P & L')}</div>
                            {(() => {
                                // 1. Sum up P&L (Already in Base Currency/THB from metrics)
                                const totalRealizedBase = Object.values(transactionMetrics).reduce((sum, m) => sum + (m.realizedPnl || 0), 0);
                                const totalUnrealizedBase = Object.values(transactionMetrics).reduce((sum, m) => sum + (m.unrealizedPnl || 0), 0);

                                // 2. Sum up Fees (Convert to Base Currency/THB)
                                const totalFeesBase = transactions.reduce((sum, tx) => {
                                    if (!tx.fees) return sum;
                                    const txCurrency = getEffectiveCurrency(tx, settings.defaultCurrency);

                                    // Inline conversion to Base
                                    let feeInBase = tx.fees;
                                    let fromCurr = txCurrency.toUpperCase();
                                    if (['USDT', 'USDC', 'BUSD', 'DAI'].includes(fromCurr)) fromCurr = 'USD';

                                    if (fromCurr !== settings.defaultCurrency) {
                                        const rate = exchangeRates[fromCurr];
                                        if (rate) feeInBase = tx.fees / rate;
                                    }
                                    return sum + feeInBase;
                                }, 0);

                                // 3. Net P&L (Base)
                                const netPnlBase = totalRealizedBase + totalUnrealizedBase - totalFeesBase;

                                // 4. Convert to Display
                                // Since values are in Base (THB), we convert 'THB' -> Display
                                const realizedDisplay = convertToDisplayCurrency(totalRealizedBase, settings.defaultCurrency);
                                const unrealizedDisplay = convertToDisplayCurrency(totalUnrealizedBase, settings.defaultCurrency);
                                const netDisplay = convertToDisplayCurrency(netPnlBase, settings.defaultCurrency);
                                const feesDisplay = convertToDisplayCurrency(totalFeesBase, settings.defaultCurrency);

                                const isPositive = netDisplay >= 0;

                                return (
                                    <>
                                        <div className={`text-xl font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isPositive ? '+' : ''}{formatCurrency(netDisplay, displayCurrency)}
                                        </div>
                                        <div className="flex flex-col gap-1 mt-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <span>R: <span className={realizedDisplay >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{formatCurrency(realizedDisplay, displayCurrency)}</span></span>
                                                <span className="text-gray-700">|</span>
                                                <span>U: <span className={unrealizedDisplay >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{formatCurrency(unrealizedDisplay, displayCurrency)}</span></span>
                                            </div>
                                            {totalFeesBase > 0 && (
                                                <div className="text-xs text-gray-500">
                                                    Fees: <span className="text-rose-400">-{formatCurrency(feesDisplay, displayCurrency)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Transaction History using TransactionList */}
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {t('ประวัติธุรกรรม', 'Transaction History')}
                            <span className="text-xs font-normal text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                                {transactions.length}
                            </span>
                        </h3>

                        <TransactionList
                            transactions={transactions}
                            portfolio={portfolio}
                            isLoading={isLoading}
                            displayCurrency={displayCurrency}
                            convertToDisplayCurrency={convertToDisplayCurrency}
                            transactionMetrics={transactionMetrics}
                        />
                    </div>
                </div>
            </div>
        </div>

    );
}
