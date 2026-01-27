
import { useMemo } from 'react';
import { PortfolioAsset, Transaction } from '../types';
import { formatCurrency, formatPercent } from '../lib/api';
import AssetLogo from './AssetLogo';

type DetailType = 'asset_type' | 'month';

interface AnalysisDetailProps {
    type: DetailType;
    title: string;
    assets?: PortfolioAsset[];
    transactions?: Transaction[];
    onBack: () => void;
}

export default function AnalysisDetail({
    type,
    title,
    assets = [],
    transactions = [],
    onBack
}: AnalysisDetailProps) {

    // Sort assets by value descending
    const sortedAssets = useMemo(() => {
        if (type !== 'asset_type') return [];
        return [...assets].sort((a, b) => b.current_value - a.current_value);
    }, [assets, type]);

    // Sort transactions by date descending
    const sortedTransactions = useMemo(() => {
        if (type !== 'month') return [];
        return [...transactions].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }, [transactions, type]);

    const totalValue = useMemo(() => {
        if (type === 'asset_type') {
            return sortedAssets.reduce((sum, asset) => sum + asset.current_value, 0);
        }
        return 0; // For transactions we might show net flow?
    }, [sortedAssets, type]);

    return (
        <div className="flex flex-col h-full bg-dark-900 absolute inset-0 z-20">
            {/* Header */}
            <div className="bg-dark-800/80 backdrop-blur-md border-b border-dark-700 p-4 sticky top-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-1 -ml-1 text-dark-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h2 className="text-lg font-bold text-white leading-tight">{title}</h2>
                        {type === 'asset_type' && (
                            <p className="text-xs text-dark-400">
                                Total: {formatCurrency(totalValue, 'THB')}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 safe-area-pb">
                {type === 'asset_type' && (
                    <div className="space-y-3">
                        {sortedAssets.map(asset => (
                            <div key={asset.symbol} className="bg-dark-800 rounded-xl p-3 border border-dark-700 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <AssetLogo
                                        symbol={asset.symbol}
                                        assetType={asset.asset_type}
                                        size="md"
                                    />
                                    <div>
                                        <div className="font-bold text-white">{asset.symbol}</div>
                                        <div className="text-xs text-dark-400">{formatCurrency(asset.avg_cost, asset.currency)} (Avg)</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-white">{formatCurrency(asset.current_value, asset.currency)}</div>
                                    <div className={`text-xs ${asset.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {asset.unrealized_pnl >= 0 ? '+' : ''}{formatCurrency(asset.unrealized_pnl, asset.currency)}
                                        <span className="opacity-75 ml-1">
                                            ({formatPercent(asset.unrealized_pnl_percent)})
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {type === 'month' && (
                    <div className="space-y-3">
                        {sortedTransactions.map(tx => (
                            <div key={tx.id} className="bg-dark-800 rounded-xl p-3 border border-dark-700">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-8 rounded-full ${tx.action === 'buy' || tx.action === 'long' || tx.action === 'deposit'
                                            ? 'bg-green-500'
                                            : 'bg-red-500'
                                            }`}></div>
                                        <div>
                                            <div className="font-bold text-white">{tx.symbol || tx.asset_type}</div>
                                            <div className="text-xs text-dark-400">
                                                {new Date(tx.timestamp).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-white">
                                            {formatCurrency(tx.price * tx.quantity, tx.currency || 'THB')}
                                        </div>
                                        <div className="text-xs text-dark-300 uppercase px-2 py-0.5 bg-dark-700 rounded text-[10px] inline-block mt-1">
                                            {tx.action}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex justify-between text-xs text-dark-400 border-t border-dark-700 pt-2 mt-2">
                                    <span>{tx.quantity} units @ {formatCurrency(tx.price, tx.currency || 'THB')}</span>
                                </div>
                            </div>
                        ))}
                        {sortedTransactions.length === 0 && (
                            <div className="text-center text-dark-400 py-8">
                                No transactions found for this month
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
