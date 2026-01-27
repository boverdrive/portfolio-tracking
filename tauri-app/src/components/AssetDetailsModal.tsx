import { useState, useEffect } from 'react';
import {
    getTransactions,
    formatCurrency,
    formatNumber,
    getAssetTypeName,
    getAssetTypeColor,
} from '../lib/api';
import type { PortfolioAsset, Transaction } from '../types';

interface AssetDetailsModalProps {
    asset: PortfolioAsset;
    onClose: () => void;
}

export default function AssetDetailsModal({ asset, onClose }: AssetDetailsModalProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTransactions = async () => {
            try {
                const allTransactions = await getTransactions();
                const assetTransactions = allTransactions
                    .filter(tx =>
                        tx.symbol === asset.symbol &&
                        tx.asset_type === asset.asset_type
                    )
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                setTransactions(assetTransactions);
            } catch (error) {
                console.error('Failed to fetch transactions:', error);
            } finally {
                setLoading(false);
            }
        };
        loadTransactions();
    }, [asset.symbol, asset.asset_type]);

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('th-TH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    const getActionColor = (action: string) => {
        switch (action) {
            case 'buy':
            case 'long':
                return 'text-green-400 bg-green-500/10';
            case 'sell':
            case 'short':
            case 'close_long':
            case 'close_short':
                return 'text-red-400 bg-red-500/10';
            default:
                return 'text-gray-400 bg-gray-500/10';
        }
    };

    const isProfit = asset.unrealized_pnl >= 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div
                className="fixed inset-x-0 bottom-0 bg-dark-900 rounded-t-3xl max-h-[85vh] overflow-hidden flex flex-col border-t border-dark-700"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle */}
                <div className="flex justify-center py-3">
                    <div className="w-10 h-1 bg-dark-600 rounded-full"></div>
                </div>

                {/* Header */}
                <div className="px-4 pb-4 flex items-center gap-4 border-b border-dark-700">
                    <div className={`w-12 h-12 rounded-xl ${getAssetTypeColor(asset.asset_type)} flex items-center justify-center`}>
                        <span className="text-white text-lg font-bold">
                            {asset.symbol.substring(0, 2)}
                        </span>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-white">{asset.symbol}</h2>
                        <p className="text-dark-400 text-sm">{getAssetTypeName(asset.asset_type)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-dark-800 p-3 rounded-xl border border-dark-700">
                            <div className="text-xs text-dark-400 mb-1">Current Price</div>
                            <div className="text-lg font-mono text-white">
                                {formatCurrency(asset.current_price, asset.currency)}
                            </div>
                        </div>
                        <div className="bg-dark-800 p-3 rounded-xl border border-dark-700">
                            <div className="text-xs text-dark-400 mb-1">Quantity</div>
                            <div className="text-lg font-mono text-white">
                                {formatNumber(asset.quantity, asset.asset_type === 'crypto' ? 6 : 2)}
                            </div>
                        </div>
                        <div className="bg-dark-800 p-3 rounded-xl border border-dark-700">
                            <div className="text-xs text-dark-400 mb-1">Total Value</div>
                            <div className="text-lg font-mono text-white">
                                {formatCurrency(asset.current_value, asset.currency)}
                            </div>
                        </div>
                        <div className="bg-dark-800 p-3 rounded-xl border border-dark-700">
                            <div className="text-xs text-dark-400 mb-1">Avg Cost</div>
                            <div className="text-lg font-mono text-white">
                                {formatCurrency(asset.avg_cost, asset.currency)}
                            </div>
                        </div>
                    </div>

                    {/* P&L Card */}
                    <div className={`p-4 rounded-xl border ${isProfit ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-xs text-dark-400 mb-1">Unrealized P&L</div>
                                <div className={`text-xl font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                    {isProfit ? '+' : ''}{formatCurrency(asset.unrealized_pnl, asset.currency)}
                                </div>
                            </div>
                            <div className={`text-2xl font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                {asset.unrealized_pnl_percent >= 0 ? '+' : ''}{asset.unrealized_pnl_percent.toFixed(2)}%
                            </div>
                        </div>
                    </div>

                    {/* Transaction History */}
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Transaction History
                            <span className="text-xs text-dark-500 bg-dark-800 px-2 py-0.5 rounded-full">
                                {transactions.length}
                            </span>
                        </h3>

                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                            </div>
                        ) : transactions.length === 0 ? (
                            <div className="text-center py-6 text-dark-400 text-sm">
                                No transactions found
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {transactions.slice(0, 20).map((tx) => (
                                    <div
                                        key={tx.id}
                                        className="bg-dark-800 rounded-lg p-3 border border-dark-700"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <span className={`text-xs uppercase font-semibold px-2 py-1 rounded ${getActionColor(tx.action)}`}>
                                                    {tx.action}
                                                </span>
                                                <div className="text-dark-400 text-xs">
                                                    {formatDate(tx.timestamp)}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-white text-sm font-medium">
                                                    {formatNumber(tx.quantity, 4)} @ {formatNumber(tx.price, 2)}
                                                </div>
                                                <div className="text-dark-400 text-xs">
                                                    {formatCurrency(tx.quantity * tx.price, tx.currency || 'THB')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {transactions.length > 20 && (
                                    <div className="text-center py-2 text-dark-400 text-xs">
                                        Showing 20 of {transactions.length} transactions
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
