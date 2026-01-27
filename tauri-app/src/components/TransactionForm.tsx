import { useState, useEffect } from 'react';
import {
    createTransaction,
    updateTransaction,
    getAccounts,
} from '../lib/api';
import type {
    Transaction,
    CreateTransactionRequest,
    AssetType,
    TradeAction,
    Market,
    Account
} from '../types';

interface TransactionFormProps {
    onSuccess?: () => void;
    onClose?: () => void;
    editTransaction?: Transaction | null;
}

const ASSET_TYPES: { value: AssetType; label: string }[] = [
    { value: 'stock', label: 'หุ้นไทย' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'foreign_stock', label: 'หุ้นต่างประเทศ' },
    { value: 'tfex', label: 'TFEX' },
    { value: 'gold', label: 'ทองคำ' },
];

const MARKETS: Record<AssetType, { value: Market; label: string }[]> = {
    stock: [{ value: 'set', label: 'SET' }],
    tfex: [{ value: 'tfex', label: 'TFEX' }],
    crypto: [
        { value: 'binance', label: 'Binance' },
        { value: 'bitkub', label: 'Bitkub' },
        { value: 'okx', label: 'OKX' },
    ],
    foreign_stock: [
        { value: 'nasdaq', label: 'NASDAQ' },
        { value: 'nyse', label: 'NYSE' },
    ],
    gold: [],
    commodity: [],
};

const getActionOptions = (assetType: AssetType): { value: TradeAction; label: string }[] => {
    if (assetType === 'tfex' || assetType === 'commodity') {
        return [
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
            { value: 'close_long', label: 'Close Long' },
            { value: 'close_short', label: 'Close Short' },
        ];
    }
    return [
        { value: 'buy', label: 'Buy' },
        { value: 'sell', label: 'Sell' },
    ];
};

const getCurrencyForAssetType = (assetType: AssetType, market?: Market): string => {
    if (assetType === 'crypto') {
        if (market === 'bitkub') return 'THB';
        return 'USDT';
    }
    if (assetType === 'foreign_stock') return 'USD';
    return 'THB';
};

export default function TransactionForm({ onSuccess, onClose, editTransaction }: TransactionFormProps) {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [assetType, setAssetType] = useState<AssetType>(editTransaction?.asset_type || 'stock');
    const [market, setMarket] = useState<Market | undefined>(editTransaction?.market);
    const [symbol, setSymbol] = useState(editTransaction?.symbol || '');
    const [action, setAction] = useState<TradeAction>(editTransaction?.action || 'buy');
    const [quantity, setQuantity] = useState(editTransaction?.quantity?.toString() || '');
    const [price, setPrice] = useState(editTransaction?.price?.toString() || '');
    const [fees, setFees] = useState(editTransaction?.fees?.toString() || '0');
    const [accountId, setAccountId] = useState(editTransaction?.account_id || '');
    const [timestamp, setTimestamp] = useState(() => {
        if (editTransaction?.timestamp) {
            return editTransaction.timestamp.substring(0, 16);
        }
        return new Date().toISOString().substring(0, 16);
    });
    const [notes, setNotes] = useState(editTransaction?.notes || '');

    useEffect(() => {
        const loadAccounts = async () => {
            try {
                const data = await getAccounts();
                setAccounts(data);
                if (!accountId && data.length > 0) {
                    setAccountId(data[0].id);
                }
            } catch (err) {
                console.error('Failed to load accounts:', err);
            }
        };
        loadAccounts();
    }, []);

    // Update market when asset type changes
    useEffect(() => {
        const markets = MARKETS[assetType];
        if (markets && markets.length > 0 && !market) {
            setMarket(markets[0].value);
        }
        // Update action for different asset types
        const actions = getActionOptions(assetType);
        if (!actions.find(a => a.value === action)) {
            setAction(actions[0].value);
        }
    }, [assetType]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const currency = getCurrencyForAssetType(assetType, market);
            const data: CreateTransactionRequest = {
                symbol: symbol.toUpperCase(),
                asset_type: assetType,
                action,
                quantity: parseFloat(quantity),
                price: parseFloat(price),
                fees: parseFloat(fees) || 0,
                currency,
                market,
                account_id: accountId || undefined,
                timestamp: new Date(timestamp).toISOString(),
                notes: notes || undefined,
            };

            if (editTransaction) {
                await updateTransaction(editTransaction.id, data);
            } else {
                await createTransaction(data);
            }

            onSuccess?.();
            onClose?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save transaction');
        } finally {
            setLoading(false);
        }
    };

    const markets = MARKETS[assetType] || [];
    const actionOptions = getActionOptions(assetType);

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                    {editTransaction ? 'Edit Transaction' : 'New Transaction'}
                </h2>
                {onClose && (
                    <button type="button" onClick={onClose} className="text-dark-400 hover:text-white">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
                    {error}
                </div>
            )}

            {/* Asset Type */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Asset Type</label>
                <select
                    value={assetType}
                    onChange={(e) => setAssetType(e.target.value as AssetType)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                >
                    {ASSET_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                </select>
            </div>

            {/* Market */}
            {markets.length > 0 && (
                <div>
                    <label className="block text-sm text-dark-400 mb-1">Market</label>
                    <select
                        value={market || ''}
                        onChange={(e) => setMarket(e.target.value as Market)}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    >
                        {markets.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Symbol */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Symbol</label>
                <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    placeholder="e.g. BTC, AAPL, PTT"
                    required
                />
            </div>

            {/* Action */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Action</label>
                <div className="grid grid-cols-2 gap-2">
                    {actionOptions.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAction(opt.value)}
                            className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${action === opt.value
                                ? opt.value.includes('long') || opt.value === 'buy'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-red-600 text-white'
                                : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                                }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Quantity & Price */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm text-dark-400 mb-1">Quantity</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                        placeholder="0"
                        step="any"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm text-dark-400 mb-1">Price</label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                        placeholder="0"
                        step="any"
                        required
                    />
                </div>
            </div>

            {/* Fees */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Fees</label>
                <input
                    type="number"
                    value={fees}
                    onChange={(e) => setFees(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    placeholder="0"
                    step="any"
                />
            </div>

            {/* Account */}
            {accounts.length > 0 && (
                <div>
                    <label className="block text-sm text-dark-400 mb-1">Account</label>
                    <select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    >
                        {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Date */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Date & Time</label>
                <input
                    type="datetime-local"
                    value={timestamp}
                    onChange={(e) => setTimestamp(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                />
            </div>

            {/* Notes */}
            <div>
                <label className="block text-sm text-dark-400 mb-1">Notes (Optional)</label>
                <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    placeholder="Optional notes..."
                />
            </div>

            {/* Total Value Preview */}
            {quantity && price && (
                <div className="bg-dark-700/50 rounded-lg p-3 text-center">
                    <div className="text-sm text-dark-400">Total Value</div>
                    <div className="text-xl font-bold text-white">
                        {(parseFloat(quantity) * parseFloat(price)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        {' '}{getCurrencyForAssetType(assetType, market)}
                    </div>
                </div>
            )}

            {/* Submit */}
            <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-dark-600 text-white rounded-lg font-semibold transition-colors"
            >
                {loading ? 'Saving...' : editTransaction ? 'Update Transaction' : 'Add Transaction'}
            </button>
        </form>
    );
}
