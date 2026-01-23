'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Account, CreateAccountRequest, UpdateAccountRequest, Transaction, PortfolioResponse } from '@/types';
import { getAccounts, createAccount, updateAccount, deleteAccount, reorderAccounts, formatCurrency, DisplayCurrency } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Predefined colors for accounts
const ACCOUNT_COLORS = [
    { name: 'Emerald', value: '#10b981' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Rose', value: '#f43f5e' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Indigo', value: '#6366f1' },
];

interface Props {
    onAccountSelect?: (accountId: string | null) => void;
    selectedAccountId?: string | null;
    transactions?: Transaction[];
    portfolio?: PortfolioResponse | null;
    displayCurrency?: DisplayCurrency;
    exchangeRates?: Record<string, number>;
}

// Sortable Item Component
function SortableAccountItem({
    account,
    isSelected,
    onSelect,
    onEdit,
    onDelete,
    currentValue,
    progressPercent,
    displayCurrency,
    t,
    formatCurrency,
    convertToDisplayCurrency
}: any) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: account.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative' as const,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`group flex items-center gap-3 px-4 py-3 rounded-lg transition-all cursor-pointer mb-2 ${isSelected
                ? 'bg-gray-700/70 border border-gray-600'
                : 'bg-gray-700/30 hover:bg-gray-700/50 border border-transparent'
                }`}
            onClick={() => onSelect?.(account.id)}
        >
            <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: account.color || ACCOUNT_COLORS[0].value }}
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                    <span className="text-white font-medium truncate">{account.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onPointerDown={(e) => e.stopPropagation()} // Prevent drag start
                            onClick={(e) => { e.stopPropagation(); onEdit(account); }}
                            className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                        <button
                            onPointerDown={(e) => e.stopPropagation()} // Prevent drag start
                            onClick={(e) => { e.stopPropagation(); onDelete(account.id); }}
                            className="p-1 hover:bg-rose-500/20 rounded text-gray-400 hover:text-rose-400"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>
                {account.description && (
                    <p className="text-sm text-gray-500 truncate">{account.description}</p>
                )}
                {account.target_value && (
                    <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>{formatCurrency(convertToDisplayCurrency(currentValue, 'THB'), displayCurrency)}</span>
                            <span className="text-gray-500">
                                {progressPercent.toFixed(1)}% {t('ของเป้าหมาย', 'of goal')}
                            </span>
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all"
                                style={{
                                    width: `${Math.min(progressPercent, 100)}%`,
                                    backgroundColor: account.color || ACCOUNT_COLORS[0].value,
                                }}
                            />
                        </div>
                        <div className="text-xs text-gray-500 mt-1 text-right">
                            {t('เป้าหมาย', 'Goal')}: {formatCurrency(convertToDisplayCurrency(account.target_value, account.target_currency), displayCurrency)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AccountManager({ onAccountSelect, selectedAccountId, transactions = [], portfolio, displayCurrency = 'THB', exchangeRates = {} }: Props) {
    const { t, settings, updateSettings } = useSettings();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [showForm, setShowForm] = useState(false);

    // Form state
    const [formData, setFormData] = useState<CreateAccountRequest>({
        name: '',
        description: '',
        color: ACCOUNT_COLORS[0].value,
        target_value: undefined,
        target_currency: 'THB',
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        loadAccounts();
    }, []);

    const loadAccounts = async () => {
        try {
            setIsLoading(true);
            const data = await getAccounts();
            setAccounts(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load accounts');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = accounts.findIndex((a) => a.id === active.id);
            const newIndex = accounts.findIndex((a) => a.id === over.id);

            const newAccounts = arrayMove(accounts, oldIndex, newIndex);
            setAccounts(newAccounts);

            // Save order to backend
            try {
                await reorderAccounts(newAccounts.map(a => a.id));
            } catch (err) {
                console.error('Failed to save order', err);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsCreating(true);

        try {
            if (editingAccount) {
                const updated = await updateAccount(editingAccount.id, formData as UpdateAccountRequest);
                setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a));
            } else {
                const newAccount = await createAccount(formData);
                setAccounts(prev => [newAccount, ...prev]);
            }
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save account');
        } finally {
            setIsCreating(false);
        }
    };

    const handleEdit = (account: Account) => {
        setEditingAccount(account);
        setFormData({
            name: account.name,
            description: account.description || '',
            color: account.color || ACCOUNT_COLORS[0].value,
            target_value: account.target_value,
            target_currency: account.target_currency || 'THB',
        });
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t('ต้องการลบบัญชีนี้หรือไม่?', 'Delete this account?'))) return;

        try {
            await deleteAccount(id);
            setAccounts(accounts.filter(a => a.id !== id));

            if (selectedAccountId === id) {
                onAccountSelect?.(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete account');
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            color: ACCOUNT_COLORS[0].value,
            target_value: undefined,
            target_currency: 'THB',
        });
        setEditingAccount(null);
        setShowForm(false);
    };

    // Convert value from source currency to display currency
    const convertToDisplayCurrency = useCallback((value: number, fromCurrency: string = 'THB'): number => {
        if (displayCurrency === fromCurrency) return value;

        // First convert to THB if not already
        let valueInThb = value;
        if (fromCurrency !== 'THB' && exchangeRates[fromCurrency]) {
            valueInThb = value / exchangeRates[fromCurrency];
        }

        // If target is THB, we're done
        if (displayCurrency === 'THB') return valueInThb;

        // Convert from THB to target currency
        const rate = exchangeRates[displayCurrency];
        if (!rate) return valueInThb;

        return valueInThb * rate;
    }, [displayCurrency, exchangeRates]);

    // Calculate current MARKET VALUE of account holdings
    const getAccountCurrentValue = (account: Account): number => {
        if (!transactions.length) return 0;

        const accountTransactions = transactions.filter(tx => tx.account_id === account.id);
        if (accountTransactions.length === 0) return 0;

        let totalValue = 0;

        // Separate spot assets from futures
        const spotTransactions = accountTransactions.filter(tx => tx.asset_type !== 'tfex');
        const futuresTransactions = accountTransactions.filter(tx => tx.asset_type === 'tfex');

        // ========== SPOT ASSETS (Stock, Crypto, Gold, etc.) ==========
        // Calculate holdings × current price, with currency conversion
        const holdings = new Map<string, number>();

        spotTransactions.forEach(tx => {
            const current = holdings.get(tx.symbol) || 0;
            if (tx.action === 'buy') {
                holdings.set(tx.symbol, current + tx.quantity);
            } else if (tx.action === 'sell') {
                holdings.set(tx.symbol, current - tx.quantity);
            }
        });

        holdings.forEach((quantity, symbol) => {
            if (quantity <= 0) return;

            const asset = portfolio?.assets?.find(a => a.symbol === symbol);
            console.log(`[AccountValue Debug] Symbol: ${symbol}, Quantity: ${quantity}, Asset:`, asset);

            if (asset && asset.current_price > 0) {
                // Calculate value in asset's native currency
                let valueInAssetCurrency = quantity * asset.current_price;
                console.log(`[AccountValue Debug] ${symbol}: ${quantity} × ${asset.current_price} = ${valueInAssetCurrency} (${asset.currency})`);

                // Convert to THB if needed
                let assetCurrency = asset.currency || 'THB';
                // Fallback: treat USDT as USD if not available
                if (assetCurrency === 'USDT' && !exchangeRates['USDT']) {
                    console.log(`[AccountValue Debug] ${symbol}: USDT not in exchangeRates, falling back to USD`);
                    assetCurrency = 'USD';
                }
                if (assetCurrency !== 'THB' && exchangeRates[assetCurrency]) {
                    // exchangeRates is THB-based, so divide to get THB
                    const oldValue = valueInAssetCurrency;
                    valueInAssetCurrency = valueInAssetCurrency / exchangeRates[assetCurrency];
                    console.log(`[AccountValue Debug] ${symbol}: Converting ${oldValue} ${assetCurrency} → ${valueInAssetCurrency} THB (rate: ${exchangeRates[assetCurrency]})`);
                }

                console.log(`[AccountValue Debug] ${symbol}: Adding ${valueInAssetCurrency} THB to totalValue`);
                totalValue += valueInAssetCurrency;
            } else {
                // Fallback: use average cost (already in transaction currency, assume THB if not specified)
                const symbolTxs = spotTransactions.filter(tx => tx.symbol === symbol && tx.action === 'buy');
                if (symbolTxs.length > 0) {
                    const avgPrice = symbolTxs.reduce((sum, tx) => sum + tx.price * tx.quantity, 0) /
                        symbolTxs.reduce((sum, tx) => sum + tx.quantity, 0);
                    let fallbackValue = quantity * avgPrice;

                    // Convert from transaction currency to THB
                    const txCurrency = symbolTxs[0]?.currency || 'THB';
                    if (txCurrency !== 'THB' && exchangeRates[txCurrency]) {
                        fallbackValue = fallbackValue / exchangeRates[txCurrency];
                    }

                    totalValue += fallbackValue;
                }
            }
        });

        // ========== FUTURES (TFEX) ==========
        // Calculate REALIZED P&L (from closed positions) + UNREALIZED P&L (from open positions)
        const futuresBySymbol = new Map<string, typeof futuresTransactions>();
        futuresTransactions.forEach(tx => {
            const list = futuresBySymbol.get(tx.symbol) || [];
            list.push(tx);
            futuresBySymbol.set(tx.symbol, list);
        });

        futuresBySymbol.forEach((txs, symbol) => {
            txs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            let longQueue: { quantity: number; price: number; leverage: number }[] = [];
            let shortQueue: { quantity: number; price: number; leverage: number }[] = [];

            txs.forEach(tx => {
                const leverage = tx.leverage || 1;

                if (tx.action === 'long') {
                    longQueue.push({ quantity: tx.quantity, price: tx.price, leverage });
                } else if (tx.action === 'close_long') {
                    let remaining = tx.quantity;
                    while (remaining > 0 && longQueue.length > 0) {
                        const entry = longQueue[0];
                        const matched = Math.min(remaining, entry.quantity);
                        const pnl = (tx.price - entry.price) * matched * entry.leverage;
                        totalValue += pnl;
                        remaining -= matched;
                        entry.quantity -= matched;
                        if (entry.quantity <= 0) longQueue.shift();
                    }
                } else if (tx.action === 'short') {
                    shortQueue.push({ quantity: tx.quantity, price: tx.price, leverage });
                } else if (tx.action === 'close_short') {
                    let remaining = tx.quantity;
                    while (remaining > 0 && shortQueue.length > 0) {
                        const entry = shortQueue[0];
                        const matched = Math.min(remaining, entry.quantity);
                        const pnl = (entry.price - tx.price) * matched * entry.leverage;
                        totalValue += pnl;
                        remaining -= matched;
                        entry.quantity -= matched;
                        if (entry.quantity <= 0) shortQueue.shift();
                    }
                }
            });

            // ========== UNREALIZED P&L for Open Positions ==========
            // Find current price from portfolio assets
            const asset = portfolio?.assets?.find(a => a.symbol === symbol && a.asset_type === 'tfex');
            const currentPrice = asset?.current_price || 0;

            // Long positions still open
            longQueue.forEach(entry => {
                if (entry.quantity > 0 && currentPrice > 0) {
                    const unrealizedPnl = (currentPrice - entry.price) * entry.quantity * entry.leverage;
                    console.log(`[TFEX Unrealized] ${symbol} Long: (${currentPrice} - ${entry.price}) × ${entry.quantity} × ${entry.leverage} = ${unrealizedPnl}`);
                    totalValue += unrealizedPnl;
                }
            });

            // Short positions still open
            shortQueue.forEach(entry => {
                if (entry.quantity > 0 && currentPrice > 0) {
                    const unrealizedPnl = (entry.price - currentPrice) * entry.quantity * entry.leverage;
                    console.log(`[TFEX Unrealized] ${symbol} Short: (${entry.price} - ${currentPrice}) × ${entry.quantity} × ${entry.leverage} = ${unrealizedPnl}`);
                    totalValue += unrealizedPnl;
                }
            });
        });

        // ========== DIVIDENDS ==========
        // Add realized dividends to account value (Cash)
        accountTransactions.filter(tx => tx.action === 'dividend').forEach(tx => {
            let dividendAmount = tx.price; // Dividend Amount is in price field
            let currency = tx.currency || 'THB';

            // Fallback: treat USDT as USD if not available in rates
            if (currency === 'USDT' && !exchangeRates['USDT']) {
                currency = 'USD';
            }

            // Convert to THB (Base Currency for aggregation)
            if (currency !== 'THB' && exchangeRates[currency]) {
                dividendAmount = dividendAmount / exchangeRates[currency];
            }

            totalValue += dividendAmount;
        });

        return totalValue;
    };

    const getProgressPercent = (account: Account): number => {
        if (!account.target_value || account.target_value <= 0) return 0;
        const currentValue = getAccountCurrentValue(account);

        // Convert target_value to THB for comparison (currentValue is already in THB)
        let targetInThb = account.target_value;
        const targetCurrency = account.target_currency || 'THB';
        if (targetCurrency !== 'THB' && exchangeRates[targetCurrency]) {
            targetInThb = account.target_value / exchangeRates[targetCurrency];
        }

        return (currentValue / targetInThb) * 100;
    };

    if (isLoading) {
        return (
            <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                <div className="flex items-center justify-center">
                    <svg className="animate-spin h-6 w-6 text-emerald-400" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="ml-2 text-gray-400">{t('กำลังโหลดบัญชี...', 'Loading accounts...')}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {t('บัญชี', 'Accounts')}
                </h2>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium transition-all"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('สร้างบัญชี', 'New Account')}
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-6 mt-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* Form */}
            {showForm && (
                <form onSubmit={handleSubmit} className="p-6 border-b border-gray-700/50 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-400 mb-2">{t('ชื่อบัญชี', 'Account Name')}</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder={t('เช่น บัญชีออม, บัญชีลงทุน', 'e.g. Savings, Investment')}
                                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                required
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-400 mb-2">{t('คำอธิบาย (ไม่บังคับ)', 'Description (optional)')}</label>
                            <input
                                type="text"
                                value={formData.description || ''}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder={t('คำอธิบายบัญชี...', 'Account description...')}
                                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">{t('สี', 'Color')}</label>
                            <div className="flex gap-2 flex-wrap">
                                {ACCOUNT_COLORS.map((color) => (
                                    <button
                                        key={color.value}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, color: color.value })}
                                        className={`w-8 h-8 rounded-lg transition-all ${formData.color === color.value ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800' : ''}`}
                                        style={{ backgroundColor: color.value }}
                                        title={color.name}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="col-span-2 grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">🎯 {t('เป้าหมาย (ไม่บังคับ)', 'Goal (optional)')}</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={formData.target_value || ''}
                                    onChange={(e) => setFormData({ ...formData, target_value: parseFloat(e.target.value) || undefined })}
                                    placeholder="100000"
                                    className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">{t('สกุลเงินเป้าหมาย', 'Goal Currency')}</label>
                                <select
                                    value={formData.target_currency}
                                    onChange={(e) => setFormData({ ...formData, target_currency: e.target.value })}
                                    className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                >
                                    <option value="THB">THB</option>
                                    <option value="USD">USD</option>
                                    <option value="BTC">BTC</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="submit"
                            disabled={isCreating}
                            className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                        >
                            {isCreating ? t('กำลังบันทึก...', 'Saving...') : editingAccount ? t('บันทึกการแก้ไข', 'Save Changes') : t('สร้างบัญชี', 'Create Account')}
                        </button>
                        <button
                            type="button"
                            onClick={resetForm}
                            className="px-4 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-all"
                        >
                            {t('ยกเลิก', 'Cancel')}
                        </button>
                    </div>
                </form>
            )}

            {/* Account List */}
            <div className="p-4">
                {/* All Accounts option */}
                <button
                    onClick={() => onAccountSelect?.(null)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all mb-2 ${selectedAccountId === null
                        ? 'bg-gray-700/70 border border-gray-600'
                        : 'bg-gray-700/30 hover:bg-gray-700/50 border border-transparent'
                        }`}
                >
                    <div className="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-400 to-blue-500" />
                    <span className="text-white font-medium">{t('ทุกบัญชี', 'All Accounts')}</span>
                </button>

                {accounts.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <p>{t('ยังไม่มีบัญชี', 'No accounts yet')}</p>
                        <p className="text-sm">{t('สร้างบัญชีเพื่อจัดกลุ่มรายการซื้อขาย', 'Create accounts to organize transactions')}</p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={accounts.map(a => a.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {accounts.map((account) => (
                                <SortableAccountItem
                                    key={account.id}
                                    account={account}
                                    isSelected={selectedAccountId === account.id}
                                    onSelect={onAccountSelect}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    currentValue={getAccountCurrentValue(account)}
                                    progressPercent={getProgressPercent(account)}
                                    displayCurrency={displayCurrency}
                                    t={t}
                                    formatCurrency={formatCurrency}
                                    convertToDisplayCurrency={convertToDisplayCurrency}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    );
}
