'use client';

import { useState, useEffect, useRef } from 'react';
import { AssetType, TradeAction, Market, CreateTransactionRequest, Account, Transaction } from '@/types';
import { createTransaction, updateTransaction, getAssetTypeName, getMarketName, getMarketsByAssetType, getAssetTypeColor, getAccounts } from '@/lib/api';
import { useSettings } from '@/contexts/SettingsContext';

// Stock symbol suggestion type
interface StockSymbol {
    symbol: string;
    name: string;
    market: string;
}

// TFEX symbol suggestion type
interface TfexSymbol {
    symbol: string;
    name: string;
    underlying: string;
    contract_type: string;
}

// Crypto symbol suggestion type
interface CryptoSymbol {
    symbol: string;
    name: string;
    category: string;
}

// Foreign stock symbol suggestion type
interface ForeignStockSymbol {
    symbol: string;
    name: string;
    market: string;
    sector: string;
}

interface Props {
    onSuccess?: () => void;
    onClose?: () => void;
    defaultAccountId?: string;
    editTransaction?: Transaction | null;
}

// Helper to get current datetime in local format for input
const getCurrentDateTimeLocal = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
};

// Convert ISO date to local datetime format
const toLocalDateTimeFormat = (isoDate: string) => {
    const date = new Date(isoDate);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
};

// Estimate TFEX multiplier from symbol
const getTfexMultiplier = (symbol: string): number => {
    if (symbol.startsWith('S50')) return 200;
    if (symbol.startsWith('GOL')) return 300; // Gold Online
    if (symbol.startsWith('GB')) return 300; // Gold Baht
    if (symbol.startsWith('USD')) return 1000;
    if (symbol.startsWith('JRIS')) return 200; // Rubber
    return 1;
};

export default function TransactionForm({ onSuccess, onClose, defaultAccountId, editTransaction }: Props) {
    const { t, settings } = useSettings();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [availableMarkets, setAvailableMarkets] = useState<Market[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);

    // String states for controlled number inputs (allow typing ".")
    // Initialize lazily from editTransaction
    const [quantityStr, setQuantityStr] = useState(() =>
        editTransaction ? String(editTransaction.quantity) : ''
    );
    const [priceStr, setPriceStr] = useState(() =>
        editTransaction ? String(editTransaction.price) : ''
    );
    const [feesStr, setFeesStr] = useState(() =>
        (editTransaction && editTransaction.fees > 0) ? String(editTransaction.fees) : ''
    );
    const [tagInput, setTagInput] = useState('');
    const [isFetchingPrice, setIsFetchingPrice] = useState(false);

    // Autocomplete state for Thai stocks and TFEX
    const [symbolSuggestions, setSymbolSuggestions] = useState<(StockSymbol | TfexSymbol)[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const symbolInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    // Crypto futures mode
    const [isFuturesMode, setIsFuturesMode] = useState(() =>
        !!(editTransaction && editTransaction.asset_type === 'crypto' &&
            (editTransaction.action === 'long' || editTransaction.action === 'short' ||
                editTransaction.action === 'close_long' || editTransaction.action === 'close_short'))
    );
    const [leverageStr, setLeverageStr] = useState(() => {
        if (editTransaction) {
            if (editTransaction.leverage) return String(editTransaction.leverage);
            if (editTransaction.asset_type === 'tfex' && editTransaction.symbol) {
                return String(getTfexMultiplier(editTransaction.symbol));
            }
        }
        return '';
    });
    const [orderAmountStr, setOrderAmountStr] = useState('');

    const [formData, setFormData] = useState<CreateTransactionRequest>(() => {
        if (editTransaction) {
            return {
                asset_type: editTransaction.asset_type,
                symbol: editTransaction.symbol,
                symbol_name: editTransaction.symbol_name,
                action: editTransaction.action,
                quantity: editTransaction.quantity,
                price: editTransaction.price,
                fees: editTransaction.fees,
                market: editTransaction.market,
                currency: editTransaction.currency,
                timestamp: toLocalDateTimeFormat(editTransaction.timestamp),
                notes: editTransaction.notes || '',
                account_id: editTransaction.account_id,
                tags: editTransaction.tags || [],
                leverage: editTransaction.leverage,
            };
        }
        return {
            asset_type: 'stock',
            symbol: '',
            symbol_name: undefined,
            action: 'buy',
            quantity: 0,
            price: 0,
            fees: 0,
            market: undefined,
            currency: 'THB',
            timestamp: getCurrentDateTimeLocal(),
            notes: '',
            account_id: defaultAccountId,
            tags: [],
        };
    });

    // Populate form when editing existing transaction (updates only)
    useEffect(() => {
        if (editTransaction) {
            setFormData({
                asset_type: editTransaction.asset_type,
                symbol: editTransaction.symbol,
                symbol_name: editTransaction.symbol_name,
                action: editTransaction.action,
                quantity: editTransaction.quantity,
                price: editTransaction.price,
                fees: editTransaction.fees,
                market: editTransaction.market,
                currency: editTransaction.currency,
                timestamp: toLocalDateTimeFormat(editTransaction.timestamp),
                notes: editTransaction.notes || '',
                account_id: editTransaction.account_id,
                tags: editTransaction.tags || [],
                leverage: editTransaction.leverage,
            });
            setQuantityStr(String(editTransaction.quantity));
            setPriceStr(String(editTransaction.price));
            setFeesStr(editTransaction.fees > 0 ? String(editTransaction.fees) : '');

            // Set leverage string for TFEX or futures
            if (editTransaction.leverage) {
                setLeverageStr(String(editTransaction.leverage));
            } else if (editTransaction.asset_type === 'tfex' && editTransaction.symbol) {
                const multiplier = getTfexMultiplier(editTransaction.symbol);
                setLeverageStr(String(multiplier));
            }

            // Set futures mode for crypto
            if (editTransaction.asset_type === 'crypto' &&
                (editTransaction.action === 'long' || editTransaction.action === 'short' ||
                    editTransaction.action === 'close_long' || editTransaction.action === 'close_short')) {
                setIsFuturesMode(true);
            }
        }
    }, [editTransaction]);

    // Load accounts
    useEffect(() => {
        getAccounts().then(setAccounts).catch(console.error);
    }, []);

    // Update available markets when asset type changes (from settings)
    useEffect(() => {
        // Get markets from settings filtered by asset type
        const configuredMarkets = settings.markets
            .filter(m => m.enabled && m.assetType === formData.asset_type)
            .map(m => m.id as Market);

        // Fallback to hardcoded if no markets configured
        const markets = configuredMarkets.length > 0
            ? configuredMarkets
            : getMarketsByAssetType(formData.asset_type);

        setAvailableMarkets(markets);

        // If editing and asset type matches, don't overwrite with defaults
        // This prevents overwriting e.g. a manually set USD currency on a Stock asset
        if (editTransaction && formData.asset_type === editTransaction.asset_type) {
            return;
        }

        // Set default market for the asset type
        if (markets.length > 0 && !formData.market) {
            setFormData(prev => ({
                ...prev,
                market: markets[0],
                currency: getCurrencyForAssetType(prev.asset_type, markets[0]),
            }));
        }
    }, [formData.asset_type, settings.markets, editTransaction]);

    const getCurrencyForAssetType = (type: AssetType, market?: Market): string => {
        if (type === 'stock' || type === 'tfex') return 'THB';
        if (type === 'foreign_stock') {
            if (market === 'nyse' || market === 'nasdaq' || market === 'amex') return 'USD';
            if (market === 'lse') return 'GBP';
            if (market === 'euronext' || market === 'xetra') return 'EUR';
            if (market === 'hkex') return 'HKD';
            if (market === 'tse') return 'JPY';
            if (market === 'sgx') return 'SGD';
        }
        if (type === 'gold' || type === 'commodity') {
            return market === 'lbma' || market === 'comex' ? 'USD' : 'THB';
        }
        if (type === 'crypto') return 'THB';
        return 'THB';
    };

    const handleAssetTypeChange = (type: AssetType) => {
        const markets = getMarketsByAssetType(type);
        const defaultMarket = markets[0];
        // Set default action based on asset type
        const defaultAction = type === 'tfex' ? 'long' : 'buy';
        setFormData({
            ...formData,
            asset_type: type,
            symbol: '',
            symbol_name: undefined,
            action: defaultAction,
            market: defaultMarket,
            currency: getCurrencyForAssetType(type, defaultMarket),
        });
    };

    const handleMarketChange = (market: Market) => {
        setFormData({
            ...formData,
            market,
            currency: getCurrencyForAssetType(formData.asset_type, market),
        });
    };

    // Fetch symbol suggestions (Thai stocks, TFEX, Crypto, or Foreign stocks)
    const fetchSymbolSuggestions = async (query: string) => {
        if (query.length < 1) {
            setSymbolSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        // Only these asset types have autocomplete
        if (formData.asset_type !== 'stock' && formData.asset_type !== 'tfex' && formData.asset_type !== 'crypto' && formData.asset_type !== 'foreign_stock') {
            setSymbolSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        setIsLoadingSuggestions(true);
        try {
            let endpoint = '/api/symbols/thai-stocks';
            let marketParam = '';
            if (formData.asset_type === 'tfex') {
                endpoint = '/api/symbols/tfex';
            } else if (formData.asset_type === 'crypto') {
                endpoint = '/api/symbols/crypto';
            } else if (formData.asset_type === 'foreign_stock') {
                endpoint = '/api/symbols/foreign-stocks';
                // Pass market filter for foreign stocks
                if (formData.market) {
                    marketParam = `&market=${formData.market}`;
                }
            }
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${endpoint}?q=${encodeURIComponent(query)}&limit=10${marketParam}`);
            if (response.ok) {
                const data = await response.json();
                setSymbolSuggestions(data);
                setShowSuggestions(data.length > 0);
            }
        } catch (error) {
            console.error('Error fetching symbol suggestions:', error);
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    // Handle symbol input change with debounce
    const handleSymbolChange = (value: string) => {
        setFormData({ ...formData, symbol: value });
        if (formData.asset_type === 'stock' || formData.asset_type === 'tfex' || formData.asset_type === 'crypto' || formData.asset_type === 'foreign_stock') {
            // Debounce API calls
            const timeoutId = setTimeout(() => {
                fetchSymbolSuggestions(value);
            }, 200);
            return () => clearTimeout(timeoutId);
        }
    };

    // Get TFEX contract multiplier based on symbol prefix
    const getTfexMultiplier = (symbol: string): number => {
        const upperSymbol = symbol.toUpperCase();
        if (upperSymbol.startsWith('S50')) return 200;      // SET50 Index Futures = 200 THB/point
        if (upperSymbol.startsWith('GF')) return 300;       // Gold Futures = 300 THB/0.1 baht
        if (upperSymbol.startsWith('GD')) return 50;        // Gold-D = 50 baht gold/contract
        if (upperSymbol.startsWith('SV')) return 100;       // Silver Futures = 100 THB/oz
        if (upperSymbol.startsWith('USD')) return 1000;     // USD Futures = 1000 USD/contract
        if (upperSymbol.startsWith('OIL')) return 50;       // Brent Oil = 50 barrels
        if (upperSymbol.startsWith('RUB')) return 1000000;  // Rubber = 1,000,000 THB
        return 1; // Default
    };

    // Handle suggestion selection
    const handleSelectSuggestion = (suggestion: StockSymbol | TfexSymbol | CryptoSymbol | ForeignStockSymbol) => {
        // Auto-set leverage/multiplier for TFEX
        if (formData.asset_type === 'tfex') {
            const multiplier = getTfexMultiplier(suggestion.symbol);
            setFormData({ ...formData, symbol: suggestion.symbol, symbol_name: suggestion.name, leverage: multiplier });
            setLeverageStr(String(multiplier));
        } else {
            setFormData({ ...formData, symbol: suggestion.symbol, symbol_name: suggestion.name });
        }
        setShowSuggestions(false);
        setSymbolSuggestions([]);
    };

    // Get action options based on asset type
    const getActionOptions = (): { value: TradeAction; label: string }[] => {
        if (formData.asset_type === 'tfex' || (formData.asset_type === 'crypto' && isFuturesMode)) {
            return [
                { value: 'long', label: t('Open Long', 'Open Long') },
                { value: 'short', label: t('Open Short', 'Open Short') },
                { value: 'close_long', label: t('Close Long', 'Close Long') },
                { value: 'close_short', label: t('Close Short', 'Close Short') },
            ];
        }
        return [
            { value: 'buy', label: t('ซื้อ', 'Buy') },
            { value: 'sell', label: t('ขาย', 'Sell') },
        ];
    };

    // Click outside to close suggestions
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                suggestionsRef.current &&
                !suggestionsRef.current.contains(event.target as Node) &&
                symbolInputRef.current &&
                !symbolInputRef.current.contains(event.target as Node)
            ) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            if (!formData.symbol.trim()) {
                throw new Error(t('กรุณาระบุสัญลักษณ์', 'Please enter a symbol'));
            }
            if (formData.quantity <= 0) {
                throw new Error(t('จำนวนต้องมากกว่า 0', 'Quantity must be greater than 0'));
            }
            if (formData.price <= 0) {
                throw new Error(t('ราคาต้องมากกว่า 0', 'Price must be greater than 0'));
            }

            const payload = {
                ...formData,
                symbol: formData.symbol.toUpperCase().trim(),
                timestamp: formData.timestamp ? new Date(formData.timestamp).toISOString() : new Date().toISOString(),
            };

            if (editTransaction) {
                // Update existing transaction
                await updateTransaction(editTransaction.id, payload);
            } else {
                // Create new transaction
                await createTransaction(payload);
            }

            onSuccess?.();

            // Reset form
            const defaultMarkets = getMarketsByAssetType('stock');
            setQuantityStr('');
            setPriceStr('');
            setFormData({
                asset_type: 'stock',
                symbol: '',
                action: 'buy',
                quantity: 0,
                price: 0,
                fees: 0,
                market: defaultMarkets[0],
                currency: 'THB',
                timestamp: getCurrentDateTimeLocal(),
                notes: '',
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
        } finally {
            setIsSubmitting(false);
        }
    };

    const assetTypes: AssetType[] = ['stock', 'foreign_stock', 'crypto', 'gold', 'tfex', 'commodity'];

    const getSymbolPlaceholder = (): string => {
        const isEn = settings.language !== 'th';
        switch (formData.asset_type) {
            case 'stock': return isEn ? 'e.g. PTT, ADVANC' : 'เช่น PTT, ADVANC';
            case 'foreign_stock': return isEn ? 'e.g. AAPL, MSFT, NVDA' : 'เช่น AAPL, MSFT, NVDA';
            case 'crypto': return isEn ? 'e.g. BTC, ETH, SOL' : 'เช่น BTC, ETH, SOL';
            case 'gold': return isEn ? 'e.g. XAU, GOLD96.5' : 'เช่น XAU, GOLD96.5';
            case 'tfex': return isEn ? 'e.g. S50, S50H25' : 'เช่น S50, S50H25';
            case 'commodity': return isEn ? 'e.g. CL, GC, SI' : 'เช่น CL, GC, SI';
            default: return '';
        }
    };

    return (
        <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={editTransaction ? "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" : "M12 6v6m0 0v6m0-6h6m-6 0H6"} />
                    </svg>
                    {editTransaction ? t('แก้ไขรายการ', 'Edit Transaction') : t('เพิ่มรายการซื้อขาย', 'Add Transaction')}
                </h2>
                {onClose && (
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {error && (
                    <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                {/* Asset Type - 2 rows */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">{t('ประเภทสินทรัพย์', 'Asset Type')}</label>
                    <div className="grid grid-cols-3 gap-2">
                        {assetTypes.map((type) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => handleAssetTypeChange(type)}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${formData.asset_type === type
                                    ? `${getAssetTypeColor(type)} text-white shadow-lg`
                                    : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                                    }`}
                            >
                                {getAssetTypeName(type, settings.language)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Market Selection */}
                {availableMarkets.length > 1 && (
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">{t('ตลาด/Exchange', 'Market/Exchange')}</label>
                        <select
                            value={formData.market || ''}
                            onChange={(e) => handleMarketChange(e.target.value as Market)}
                            className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        >
                            {availableMarkets.map((market) => {
                                const marketConfig = settings.markets.find(m => m.id === market);
                                const displayName = marketConfig
                                    ? (settings.language === 'th' ? marketConfig.name : marketConfig.nameEn)
                                    : getMarketName(market, settings.language);
                                return (
                                    <option key={market} value={market}>
                                        {displayName}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                )}

                {/* TFEX Contract Multiplier - Editable */}
                {formData.asset_type === 'tfex' && formData.symbol && (
                    <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="block text-sm font-medium text-amber-300">{t('ตัวคูณสัญญา', 'Contract Multiplier')}</label>
                                <span className="text-xs text-amber-400/70">
                                    {t('Auto:', 'Auto:')} {getTfexMultiplier(formData.symbol)}x
                                    {formData.symbol.toUpperCase().startsWith('S50') && ' (THB/point)'}
                                    {formData.symbol.toUpperCase().startsWith('GF') && ' (THB/0.1 baht)'}
                                    {formData.symbol.toUpperCase().startsWith('GD') && ' (baht gold)'}
                                    {formData.symbol.toUpperCase().startsWith('SV') && ' (THB/oz)'}
                                    {formData.symbol.toUpperCase().startsWith('USD') && ' (USD)'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={leverageStr}
                                    onChange={(e) => {
                                        setLeverageStr(e.target.value);
                                        const val = parseFloat(e.target.value);
                                        setFormData(prev => ({ ...prev, leverage: isNaN(val) ? undefined : val }));
                                    }}
                                    className="w-24 px-3 py-2 text-lg font-bold bg-amber-800/50 border border-amber-600 rounded-lg text-amber-300 text-center focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                />
                                <span className="text-amber-400 font-bold">x</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Crypto Futures Toggle */}
                {formData.asset_type === 'crypto' && (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <label className="block text-sm font-medium text-white">{t('เทรด Futures', 'Futures Trading')}</label>
                                <span className="text-xs text-gray-400">{t('Long/Short พร้อมตัวคูณ', 'Long/Short with leverage')}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsFuturesMode(!isFuturesMode);
                                    // Reset action to buy when switching off futures mode
                                    if (isFuturesMode) {
                                        setFormData(prev => ({ ...prev, action: 'buy', leverage: undefined }));
                                        setLeverageStr('');
                                    } else {
                                        setFormData(prev => ({ ...prev, action: 'long' }));
                                    }
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isFuturesMode ? 'bg-purple-600' : 'bg-gray-600'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isFuturesMode ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {/* Leverage Input */}
                        {isFuturesMode && (
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">{t('ตัวคูณ (Leverage)', 'Leverage')}</label>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {[5, 10, 20, 50, 100].map((lev) => (
                                        <button
                                            key={lev}
                                            type="button"
                                            onClick={() => {
                                                setLeverageStr(String(lev));
                                                setFormData(prev => ({ ...prev, leverage: lev }));
                                            }}
                                            className={`px-3 py-2 text-sm rounded-lg font-medium transition-all border ${Number(formData.leverage) === lev
                                                ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/25'
                                                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                                                }`}
                                        >
                                            {lev}x
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        value={leverageStr}
                                        onChange={(e) => {
                                            setLeverageStr(e.target.value);
                                            const val = parseFloat(e.target.value);
                                            setFormData(prev => ({ ...prev, leverage: isNaN(val) ? undefined : val }));
                                        }}
                                        placeholder={t('อื่นๆ', 'Custom')}
                                        className="w-20 px-2 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Order Amount - Auto calculate quantity */}
                        {isFuturesMode && (
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">
                                    {t('มูลค่าออเดอร์', 'Order Amount')}
                                    <span className="text-gray-500 ml-1">(Position Size)</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={orderAmountStr}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                                setOrderAmountStr(val);
                                                // Auto calculate quantity = orderAmount / price
                                                const amount = parseFloat(val);
                                                if (!isNaN(amount) && formData.price > 0) {
                                                    const qty = amount / formData.price;
                                                    setQuantityStr(qty.toFixed(8));
                                                    setFormData(prev => ({ ...prev, quantity: qty }));
                                                }
                                            }
                                        }}
                                        placeholder="117.27"
                                        className="flex-1 px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 font-mono"
                                    />
                                    <span className="text-gray-400 text-sm">{formData.currency || 'USD'}</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            // Calculate from current quantity and price
                                            if (formData.quantity > 0 && formData.price > 0) {
                                                const amount = formData.quantity * formData.price;
                                                setOrderAmountStr(amount.toFixed(2));
                                            }
                                        }}
                                        className="px-2 py-2 text-xs bg-gray-600 hover:bg-gray-500 rounded-lg text-gray-300 transition-all"
                                        title={t('คำนวณจาก Quantity', 'Calculate from Quantity')}
                                    >
                                        ⟲
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('Quantity = Order Amount ÷ Price', 'Quantity = Order Amount ÷ Price')}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Action */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">{t('ประเภทรายการ', 'Action')}</label>
                    <div className={`grid gap-2 ${formData.asset_type === 'tfex' ? 'grid-cols-2' : 'grid-cols-2'}`}>
                        {getActionOptions().map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setFormData({ ...formData, action: option.value })}
                                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${formData.action === option.value
                                    ? (option.value === 'buy' || option.value === 'long')
                                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                                        : (option.value === 'sell' || option.value === 'short')
                                            ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25'
                                            : (option.value === 'close_long')
                                                ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                                                : 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                                    : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                                    }`}
                            >
                                {option.value === 'buy' ? '🛒 ' : option.value === 'sell' ? '💰 ' : option.value === 'long' ? '📈 ' : option.value === 'short' ? '📉 ' : option.value === 'close_long' ? '✅ ' : '🔄 '}
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Symbol */}
                <div className="relative">
                    <label className="block text-sm font-medium text-gray-400 mb-2">{t('สัญลักษณ์', 'Symbol')}</label>
                    <input
                        ref={symbolInputRef}
                        type="text"
                        value={formData.symbol}
                        onChange={(e) => handleSymbolChange(e.target.value)}
                        onFocus={() => {
                            if ((formData.asset_type === 'stock' || formData.asset_type === 'tfex' || formData.asset_type === 'crypto' || formData.asset_type === 'foreign_stock') && formData.symbol.length >= 1) {
                                fetchSymbolSuggestions(formData.symbol);
                            }
                        }}
                        placeholder={getSymbolPlaceholder()}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        autoComplete="off"
                    />

                    {/* Autocomplete Dropdown */}
                    {showSuggestions && (formData.asset_type === 'stock' || formData.asset_type === 'tfex' || formData.asset_type === 'crypto' || formData.asset_type === 'foreign_stock') && (
                        <div
                            ref={suggestionsRef}
                            className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                        >
                            {isLoadingSuggestions ? (
                                <div className="px-4 py-3 text-gray-400 text-sm flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    {t('กำลังค้นหา...', 'Searching...')}
                                </div>
                            ) : symbolSuggestions.length > 0 ? (
                                symbolSuggestions.map((suggestion) => (
                                    <button
                                        key={suggestion.symbol}
                                        type="button"
                                        onClick={() => handleSelectSuggestion(suggestion)}
                                        className="w-full px-4 py-2 text-left hover:bg-gray-700/50 transition-colors flex items-center justify-between group"
                                    >
                                        <div>
                                            <span className="text-white font-medium">{suggestion.symbol}</span>
                                            <span className="text-gray-400 text-sm ml-2">{suggestion.name}</span>
                                        </div>
                                        <span className="text-xs text-gray-500 group-hover:text-gray-400">
                                            {'market' in suggestion ? suggestion.market : ('contract_type' in suggestion ? (suggestion as TfexSymbol).contract_type : '')}
                                        </span>
                                    </button>
                                ))
                            ) : (
                                <div className="px-4 py-3 text-gray-400 text-sm">
                                    {t('ไม่พบผลลัพธ์', 'No results found')}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Display selected symbol name */}
                    {formData.symbol_name && (
                        <div className="mt-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                            <span className="text-emerald-400 text-sm">{formData.symbol_name}</span>
                        </div>
                    )}
                </div>

                {/* Quantity */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">{t('จำนวน', 'Quantity')}</label>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={quantityStr}
                        onChange={(e) => {
                            const val = e.target.value;
                            // Allow empty, numbers, and decimal point
                            if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                setQuantityStr(val);
                                // Only update formData when it's a valid number
                                const num = parseFloat(val);
                                if (!isNaN(num)) {
                                    setFormData(prev => ({ ...prev, quantity: num }));
                                } else if (val === '') {
                                    setFormData(prev => ({ ...prev, quantity: 0 }));
                                }
                            }
                        }}
                        placeholder="0.00000001"
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                    />
                </div>

                {/* Price */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-400">
                                {t('ราคา', 'Price')}
                            </label>
                            <select
                                value={formData.currency || 'THB'}
                                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                className="px-2 py-1 bg-gray-700/50 border border-gray-600/50 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                            >
                                <option value="THB">THB</option>
                                <option value="USD">USD</option>
                                <option value="EUR">EUR</option>
                                <option value="GBP">GBP</option>
                                <option value="JPY">JPY</option>
                                <option value="HKD">HKD</option>
                                <option value="SGD">SGD</option>
                                <option value="BTC">BTC</option>
                            </select>
                        </div>
                        <button
                            type="button"
                            disabled={!formData.symbol || isFetchingPrice}
                            onClick={async () => {
                                if (!formData.symbol) return;
                                setIsFetchingPrice(true);
                                try {
                                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                                    const marketParam = formData.market ? `&market=${formData.market}` : '';
                                    const response = await fetch(
                                        `${apiUrl}/api/prices/${encodeURIComponent(formData.symbol)}?asset_type=${formData.asset_type}${marketParam}`
                                    );
                                    if (response.ok) {
                                        const data = await response.json();
                                        if (data.price) {
                                            setPriceStr(String(data.price));
                                            setFormData(prev => ({ ...prev, price: data.price }));
                                        }
                                    } else {
                                        console.error('Failed to fetch price');
                                    }
                                } catch (error) {
                                    console.error('Error fetching price:', error);
                                } finally {
                                    setIsFetchingPrice(false);
                                }
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 disabled:bg-gray-700/30 disabled:cursor-not-allowed border border-blue-500/30 disabled:border-gray-600/30 rounded-md text-blue-400 disabled:text-gray-500 transition-all"
                            title={t('ดึงราคาล่าสุด', 'Fetch Latest Price')}
                        >
                            {isFetchingPrice ? (
                                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                            ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            )}
                            {t('ดึงราคา', 'Fetch')}
                        </button>
                    </div>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={priceStr}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                setPriceStr(val);
                                const num = parseFloat(val);
                                if (!isNaN(num)) {
                                    setFormData(prev => ({ ...prev, price: num }));
                                } else if (val === '') {
                                    setFormData(prev => ({ ...prev, price: 0 }));
                                }
                            }
                        }}
                        placeholder="0.00"
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                    />
                </div>

                {/* Total Preview */}
                {formData.quantity > 0 && formData.price > 0 && (
                    <div className="bg-gray-700/30 rounded-lg px-4 py-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">
                                {t('มูลค่ารวม', 'Total Value')}
                                {((formData.leverage || 0) > 1) && (
                                    <span className="text-amber-400 ml-1">(×{formData.leverage})</span>
                                )}
                            </span>
                            <span className="text-white font-semibold font-mono">
                                {formData.currency} {((formData.quantity * formData.price) * (formData.leverage || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>
                )}

                {/* Fees */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                        {t('ค่าธรรมเนียม', 'Fees')} ({formData.currency || 'THB'})
                    </label>
                    <input
                        type="number"
                        step="any"
                        value={formData.fees || ''}
                        onChange={(e) => setFormData({ ...formData, fees: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                    />
                </div>

                {/* Date/Time */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                        📅 {t('วันที่และเวลา', 'Date and Time')}
                    </label>
                    <input
                        type="datetime-local"
                        value={formData.timestamp || ''}
                        onChange={(e) => setFormData({ ...formData, timestamp: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                    />
                </div>

                {/* Account Selection */}
                {
                    accounts.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">📁 {t('บัญชี', 'Account')}</label>
                            <select
                                value={formData.account_id || ''}
                                onChange={(e) => setFormData({ ...formData, account_id: e.target.value || undefined })}
                                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                            >
                                <option value="">{t('ไม่ระบุบัญชี', 'No Account')}</option>
                                {accounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                        {account.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )
                }

                {/* Tags */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">🏷️ {t('แท็ก', 'Tags')}</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {(formData.tags || []).map((tag, idx) => (
                            <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 text-sm rounded-lg"
                            >
                                {tag}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const newTags = [...(formData.tags || [])];
                                        newTags.splice(idx, 1);
                                        setFormData({ ...formData, tags: newTags });
                                    }}
                                    className="hover:text-emerald-200 transition-colors"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && tagInput.trim()) {
                                    e.preventDefault();
                                    const newTag = tagInput.trim();
                                    if (!(formData.tags || []).includes(newTag)) {
                                        setFormData({ ...formData, tags: [...(formData.tags || []), newTag] });
                                    }
                                    setTagInput('');
                                }
                            }}
                            placeholder={t('พิมพ์แท็กแล้วกด Enter', 'Type tag and press Enter')}
                            className="flex-1 px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                if (tagInput.trim()) {
                                    const newTag = tagInput.trim();
                                    if (!(formData.tags || []).includes(newTag)) {
                                        setFormData({ ...formData, tags: [...(formData.tags || []), newTag] });
                                    }
                                    setTagInput('');
                                }
                            }}
                            className="px-3 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-all text-sm"
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">{t('หมายเหตุ (ไม่บังคับ)', 'Notes (optional)')}</label>
                    <textarea
                        value={formData.notes || ''}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        placeholder={t('เพิ่มหมายเหตุ...', 'Add notes...')}
                        rows={2}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                    />
                </div>

                {/* Submit */}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full py-3 rounded-lg font-semibold text-white transition-all ${(formData.action === 'buy' || formData.action === 'long')
                        ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/25'
                        : 'bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-lg shadow-rose-500/25'
                        } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            {t('กำลังบันทึก...', 'Saving...')}
                        </span>
                    ) : editTransaction ? (
                        t('บันทึกการแก้ไข', 'Save Changes')
                    ) : (
                        (() => {
                            switch (formData.action) {
                                case 'buy': return t('บันทึกรายการซื้อ', 'Save Buy Transaction');
                                case 'sell': return t('บันทึกรายการขาย', 'Save Sell Transaction');
                                case 'long': return t('บันทึก Open Long', 'Save Open Long');
                                case 'short': return t('บันทึก Open Short', 'Save Open Short');
                                case 'close_long': return t('บันทึก Close Long', 'Save Close Long');
                                case 'close_short': return t('บันทึก Close Short', 'Save Close Short');
                                default: return t('บันทึก', 'Save');
                            }
                        })()
                    )}
                </button>

                {/* Cancel button for edit mode */}
                {
                    editTransaction && onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full py-2.5 mt-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-all"
                        >
                            {t('ยกเลิก', 'Cancel')}
                        </button>
                    )
                }
            </form >
        </div >
    );
}
