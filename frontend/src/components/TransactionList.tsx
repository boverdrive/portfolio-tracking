'use client';

import { Transaction, PortfolioResponse } from '@/types';
import { formatCurrency, formatNumber, getAssetTypeName, DisplayCurrency, formatPercent } from '@/lib/api';
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
}

export default function TransactionList({ transactions, portfolio, isLoading, onDelete, onEdit, displayCurrency = 'THB', convertToDisplayCurrency }: Props) {
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
                const multiplier = tx.leverage || 1;
                const totalValue = tx.quantity * tx.price * multiplier;

                // P&L Calculation logic
                let pnl = 0;
                let pnlPercent = 0;
                let showPnl = false;

                if (portfolio && (tx.action === 'buy' || tx.action === 'long' || tx.action === 'short')) {
                    const asset = portfolio.assets.find(a => a.symbol === tx.symbol);

                    // Get current price from portfolio assets or fallback to assetPrices prop
                    let currentPriceVal = 0;
                    let assetCurrency = tx.currency || 'THB';

                    if (asset) {
                        assetCurrency = asset.currency;
                        currentPriceVal = convertToDisplayCurrency
                            ? convertToDisplayCurrency(asset.current_price, asset.currency)
                            : asset.current_price;
                    } else if ((portfolio as any).assetPrices) {
                        // Fallback to assetPrices if available
                        const priceRecord = (portfolio as any).assetPrices.find((p: any) => p.symbol === tx.symbol);
                        if (priceRecord) {
                            assetCurrency = priceRecord.currency;
                            currentPriceVal = convertToDisplayCurrency
                                ? convertToDisplayCurrency(priceRecord.price, priceRecord.currency)
                                : priceRecord.price;
                        }
                    }

                    if (currentPriceVal > 0) {
                        const txPriceVal = convertToDisplayCurrency
                            ? convertToDisplayCurrency(tx.price, tx.currency)
                            : tx.price;

                        const entryTotal = tx.quantity * txPriceVal * multiplier;
                        const currentTotal = tx.quantity * currentPriceVal * multiplier;

                        if (tx.action === 'short') {
                            pnl = entryTotal - currentTotal;
                        } else {
                            pnl = currentTotal - entryTotal;
                        }

                        pnlPercent = entryTotal !== 0 ? (pnl / entryTotal) * 100 : 0;
                        showPnl = true;
                    }
                }

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
                                        convertToDisplayCurrency ? convertToDisplayCurrency(tx.price, tx.currency) : tx.price,
                                        displayCurrency
                                    )}
                                    {multiplier > 1 && (
                                        <span className="text-amber-400 ml-1">(×{multiplier})</span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {formatDate(tx.timestamp)}
                                </div>
                            </div>

                            {/* Value & P&L */}
                            <div className="text-right">
                                <div className="font-mono text-white font-medium">
                                    {convertToDisplayCurrency
                                        ? formatCurrency(convertToDisplayCurrency(totalValue, tx.currency), displayCurrency)
                                        : formatCurrency(totalValue, tx.currency || 'THB')
                                    }
                                </div>
                                {showPnl ? (
                                    <div className={`text-xs font-medium ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnl >= 0 ? '+' : ''}{convertToDisplayCurrency ? formatCurrency(pnl, displayCurrency) : formatCurrency(pnl, 'THB')} ({formatPercent(pnlPercent)})
                                    </div>
                                ) : (
                                    tx.fees > 0 && (
                                        <div className="text-xs text-gray-500">
                                            {t('ค่าธรรมเนียม', 'Fees')}: {formatCurrency(
                                                convertToDisplayCurrency ? convertToDisplayCurrency(tx.fees, tx.currency) : tx.fees,
                                                displayCurrency
                                            )}
                                        </div>
                                    )
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
