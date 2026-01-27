import { useState, useEffect } from 'react';
import {
    getTransactions,
    deleteTransaction,
    formatCurrency,
    getAssetTypeColor,
} from '../lib/api';
import type { Transaction } from '../types';

interface TransactionListProps {
    onEdit?: (transaction: Transaction) => void;
    onAddNew?: () => void;
    refreshTrigger?: number;
}

export default function TransactionList({ onEdit, onAddNew, refreshTrigger }: TransactionListProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTransactions = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getTransactions();
            // Sort by date descending
            data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setTransactions(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTransactions();
    }, [refreshTrigger]);

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this transaction?')) return;
        try {
            await deleteTransaction(id);
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (err) {
            alert('Failed to delete transaction');
        }
    };

    const getActionColor = (action: string) => {
        switch (action) {
            case 'buy':
            case 'long':
                return 'text-green-400';
            case 'sell':
            case 'short':
            case 'close_long':
            case 'close_short':
                return 'text-red-400';
            case 'transfer':
                return 'text-blue-400';
            default:
                return 'text-gray-400';
        }
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('th-TH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 text-center">
                <p className="text-red-300 text-sm">{error}</p>
                <button onClick={fetchTransactions} className="mt-2 text-primary-400 text-sm">
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Transactions</h2>
                {onAddNew && (
                    <button
                        onClick={onAddNew}
                        className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm flex items-center gap-1"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add
                    </button>
                )}
            </div>

            {/* Transaction List */}
            {transactions.length === 0 ? (
                <div className="text-center py-8 text-dark-400">
                    No transactions yet
                </div>
            ) : (
                <div className="space-y-2">
                    {transactions.slice(0, 50).map((tx) => (
                        <div
                            key={tx.id}
                            className="bg-dark-800 rounded-lg p-3 border border-dark-700"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-lg ${getAssetTypeColor(tx.asset_type)} flex items-center justify-center`}>
                                        <span className="text-white text-xs font-bold">
                                            {tx.symbol.substring(0, 2)}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-white text-sm">{tx.symbol}</span>
                                            <span className={`text-xs uppercase font-medium ${getActionColor(tx.action)}`}>
                                                {tx.action}
                                            </span>
                                        </div>
                                        <div className="text-xs text-dark-400">
                                            {formatDate(tx.timestamp)} • {tx.quantity} @ {tx.price}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-medium text-white">
                                        {formatCurrency(tx.quantity * tx.price, tx.currency || 'THB')}
                                    </div>
                                    <div className="flex items-center gap-1 justify-end mt-1">
                                        {onEdit && (
                                            <button
                                                onClick={() => onEdit(tx)}
                                                className="text-xs text-blue-400 hover:text-blue-300"
                                            >
                                                Edit
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDelete(tx.id)}
                                            className="text-xs text-red-400 hover:text-red-300 ml-2"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {transactions.length > 50 && (
                        <div className="text-center py-2 text-dark-400 text-sm">
                            Showing 50 of {transactions.length} transactions
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
