'use client';

import { Transaction, PortfolioResponse } from '@/types';
import { formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, formatPercent, getEffectiveCurrency } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';
import AssetLogo from '@/components/AssetLogo';

interface Props {
    transactions: Transaction[];
    portfolio?: PortfolioResponse | null;
    isLoading?: boolean;
    onDelete?: (id: string) => void;
    onEdit?: (transaction: Transaction) => void;
    displayCurrency?: DisplayCurrency;
    convertToDisplayCurrency?: (value: number, fromCurrency?: string) => number;
    transactionMetrics?: Record<string, { realizedPnl?: number, unrealizedPnl?: number, remainingQty?: number }>;
}

export default function TransactionList({ transactions, portfolio, isLoading, onDelete, onEdit, displayCurrency = 'THB', convertToDisplayCurrency, transactionMetrics }: Props) {
    const { t, settings } = useSettings();

    if (isLoading) {
        return (
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="bg-gray-800/50 rounded-lg p-4 animate-pulse">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gray-700 rounded-full"></div>
                            <div className="flex-1">
                                <div className="h-4 bg-gray-700 rounded w-32 mb-2"></div>
                                <div className="h-3 bg-gray-700 rounded w-24"></div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500">
                <p>{t('ยังไม่มีรายการซื้อขาย', 'No transactions yet')}</p>
            </div>
        );
    }

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const locale = settings.language === 'th' ? 'th-TH' : 'en-US';
        return date.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="space-y-3">
            {transactions.map((tx, index) => {
                // Check if it's a "positive" action (buy/long) or "negative" action (sell/short/close)
                const isPositive = tx.action === 'buy' || tx.action === 'long';
                // For TFEX, leverage = contract multiplier (affects value). For Crypto, it's just financial leverage.
                const valueMultiplier = (tx.asset_type === 'tfex') ? (tx.leverage || 1) : 1;
                const displayLeverage = tx.leverage || 1;
                // Determine effective currency (handle cases where API returns 'THB' for USDT pairs)
                const effectiveTxCurrency = getEffectiveCurrency(tx, 'THB');
                const totalValue = tx.quantity * tx.price * valueMultiplier;

                // P&L Calculation logic
                let pnl = 0;
                let pnlPercent = 0;
                let showPnl = false;
                let isRealized = false;

                // Priority 1: Use pre-calculated metrics if available (FIFO/Match logic)
                if (transactionMetrics && transactionMetrics[tx.id]) {
                    const metrics = transactionMetrics[tx.id];
                    const isOpening = tx.action === 'buy' || tx.action === 'long' || tx.action === 'short';
                    const isClosing = tx.action === 'sell' || tx.action === 'close_long' || tx.action === 'close_short';

                    if (isClosing) {
                        // Closing actions = Realized P&L
                        pnl = metrics.realizedPnl || 0;
                        isRealized = true;

                        // Cost Basis for closing = Value - PnL
                        const costBasis = totalValue - pnl;
                        pnlPercent = costBasis !== 0 ? (pnl / costBasis) * 100 : 0;
                        showPnl = true;
                    } else if (isOpening && metrics.remainingQty && metrics.remainingQty > 0) {
                        // Open positions = Unrealized P&L
                        pnl = metrics.unrealizedPnl || 0;
                        isRealized = false;

                        // Cost basis of the remaining part
                        // Cost basis of the remaining part in Display Currency
                        const itemPrice = convertToDisplayCurrency ? convertToDisplayCurrency(tx.price, effectiveTxCurrency) : tx.price;
                        const remainingCost = metrics.remainingQty * itemPrice * valueMultiplier;

                        // Pnl is in Base Currency (THB), convert to Display Currency for consistent ratio
                        const pnlInDisplay = convertToDisplayCurrency ? convertToDisplayCurrency(pnl, 'THB') : pnl;

                        let rawPercent = remainingCost !== 0 ? (pnlInDisplay / remainingCost) * 100 : 0;

                        // For Crypto, if there is leverage, show ROE (Return on Equity) approximation
                        if (tx.asset_type === 'crypto' && displayLeverage > 1) {
                            rawPercent *= displayLeverage;
                        }

                        pnlPercent = rawPercent;
                        showPnl = true;
                    }
                }
                // Priority 2: Legacy/Global calculation (Only for fully held portfolios or simple view?)
                // DISABLED as requested by user to avoid confusion on mixed histories
                /*
                else if (portfolio && (tx.action === 'buy' || tx.action === 'long' || tx.action === 'short')) {
                   // ... (kept disabled)
                }
                */

                // Get action label and color
                const getActionDisplay = () => {
                    switch (tx.action) {
                        case 'buy': return { label: t('ซื้อ', 'Buy'), color: 'bg-emerald-500/20 text-emerald-400' };
                        case 'sell': return { label: t('ขาย', 'Sell'), color: 'bg-rose-500/20 text-rose-400' };
                        case 'long': return { label: 'Long', color: 'bg-emerald-500/20 text-emerald-400' };
                        case 'short': return { label: 'Short', color: 'bg-rose-500/20 text-rose-400' };
                        case 'close_long': return { label: t('ปิด Long', 'Close Long'), color: 'bg-amber-500/20 text-amber-400' };
                        case 'close_short': return { label: t('ปิด Short', 'Close Short'), color: 'bg-purple-500/20 text-purple-400' };
                        default: return { label: tx.action, color: 'bg-gray-500/20 text-gray-400' };
                    }
                };
                const actionDisplay = getActionDisplay();

                return (
                    <div
                        key={tx.id}
                        className={`bg-gradient-to-r from-gray-800/80 to-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50 p-4 transition-all hover:border-gray-600/50 ${isPositive ? 'hover:shadow-emerald-500/5' : 'hover:shadow-rose-500/5'
                            } hover:shadow-lg`}
                        style={{ animationDelay: `${index * 30}ms` }}
                    >
                        <div className="flex items-center gap-4">
                            {/* Icon */}
                            <AssetLogo symbol={tx.symbol} assetType={tx.asset_type} size="md" />

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="font-semibold text-white">{tx.symbol}</span>
                                    {tx.symbol_name && (
                                        <span className="text-xs text-gray-400 truncate max-w-[100px] sm:max-w-[200px]" title={tx.symbol_name}>
                                            {tx.symbol_name}
                                        </span>
                                    )}
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionDisplay.color}`}>
                                        {actionDisplay.label}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {getAssetTypeName(tx.asset_type, settings.language)}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-400">
                                    {tx.quantity.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 })} × {formatCurrency(
                                        convertToDisplayCurrency ? convertToDisplayCurrency(tx.price, effectiveTxCurrency) : tx.price,
                                        displayCurrency
                                    )}
                                    {displayLeverage > 1 && (
                                        <span className="text-amber-400 ml-1">(×{displayLeverage})</span>
                                    )}
                                </div>
                                {(() => {
                                    const asset = portfolio?.assets.find(a => a.symbol === tx.symbol && a.asset_type === tx.asset_type);
                                    if (asset?.current_price && (isPositive || (transactionMetrics?.[tx.id]?.remainingQty || 0) > 0)) {
                                        const entryPrice = convertToDisplayCurrency ? convertToDisplayCurrency(tx.price, effectiveTxCurrency) : tx.price;
                                        const currentPrice = convertToDisplayCurrency ? convertToDisplayCurrency(asset.current_price, asset.currency) : asset.current_price;

                                        const currentVal = tx.quantity * currentPrice * valueMultiplier; // Use converted current price for value calc? 
                                        // No, currentVal logic below uses asset.currency, let's keep it consistent.
                                        // Wait, currentVal block is separate (lines 195+). This block is for Entry/Current labels.

                                        return (
                                            <div className="flex flex-wrap gap-2 text-xs mt-1 font-medium">
                                                <span className="text-gray-400">
                                                    {t('ทุน', 'Entry')}: <span className="text-gray-300">{formatCurrency(entryPrice, displayCurrency)}</span>
                                                </span>
                                                <span className="text-gray-600">•</span>
                                                <span className="text-blue-400">
                                                    {t('ราคาปัจจุบัน', 'Current')}: {formatCurrency(currentPrice, displayCurrency)}
                                                </span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                                <div className="text-xs text-gray-500 mt-1">
                                    {formatDate(tx.timestamp)}
                                </div>
                            </div>

                            {/* Value & P&L */}
                            <div className="text-right">
                                <div className="font-mono text-white font-medium">
                                    {convertToDisplayCurrency
                                        ? formatCurrency(convertToDisplayCurrency(totalValue, effectiveTxCurrency), displayCurrency)
                                        : formatCurrency(totalValue, effectiveTxCurrency || 'THB')
                                    }
                                </div>
                                {(() => {
                                    const asset = portfolio?.assets.find(a => a.symbol === tx.symbol && a.asset_type === tx.asset_type);
                                    if (asset?.current_price && (isPositive || (transactionMetrics?.[tx.id]?.remainingQty || 0) > 0)) {
                                        const currentVal = tx.quantity * asset.current_price * valueMultiplier;
                                        return (
                                            <div className="text-xs text-blue-400 font-medium leading-none mb-1">
                                                {convertToDisplayCurrency
                                                    ? formatCurrency(convertToDisplayCurrency(currentVal, asset.currency), displayCurrency)
                                                    : formatCurrency(currentVal, asset.currency || 'THB')
                                                }
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                                {showPnl && (
                                    <div className={`text-xs font-medium ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnl >= 0 ? '+' : ''}{convertToDisplayCurrency ? formatCurrency(convertToDisplayCurrency(pnl, 'THB'), displayCurrency) : formatCurrency(pnl, 'THB')} ({formatPercent(pnlPercent)})
                                    </div>
                                )}
                                {tx.fees > 0 && (
                                    <div className="text-xs text-gray-500">
                                        {t('ค่าธรรมเนียม', 'Fees')}: {formatCurrency(
                                            convertToDisplayCurrency ? convertToDisplayCurrency(tx.fees, tx.currency) : tx.fees,
                                            displayCurrency
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1">
                                {onEdit && (
                                    <button
                                        onClick={() => onEdit(tx)}
                                        className="p-2 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all"
                                        title={t('แก้ไขรายการ', 'Edit')}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                )}
                                {onDelete && (
                                    <button
                                        onClick={() => onDelete(tx.id)}
                                        className="p-2 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                        title={t('ลบรายการ', 'Delete')}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Notes */}
                        {
                            tx.notes && (
                                <div className="mt-3 pt-3 border-t border-gray-700/50">
                                    <p className="text-sm text-gray-400 italic">{tx.notes}</p>
                                </div>
                            )
                        }
                    </div>
                );
            })}
        </div>
    );
}
