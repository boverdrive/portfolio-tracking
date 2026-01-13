'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Types
export type Theme = 'dark' | 'light';

export interface LanguageConfig {
    code: string;
    name: string;
    nativeName: string;
    flag: string;
    enabled: boolean;
}

export interface AssetTypeConfig {
    id: string;
    name: string;
    nameEn: string;
    color: string;
    icon: string;
    enabled: boolean;
}

export interface MarketConfig {
    id: string;
    name: string;
    nameEn: string;
    assetType: string;
    currency: string;
    enabled: boolean;
    priceSource?: string; // API source for fetching prices
}

export interface CurrencyConfig {
    code: string;
    name: string;
    symbol: string;
    enabled: boolean;
}

export interface ExchangeRateOverride {
    from: string;
    to: string;
    rate: number;
    isManual: boolean;
}

export interface AppSettings {
    // Language
    language: string;  // Now uses language code

    // Theme
    theme: Theme;

    // Default values
    defaultCurrency: string;
    defaultAssetType: string;

    // Display currency (for converting values in UI)
    displayCurrency: 'THB' | 'USD' | 'BTC';

    // Master data
    languages: LanguageConfig[];
    assetTypes: AssetTypeConfig[];
    markets: MarketConfig[];
    currencies: CurrencyConfig[];
    exchangeRateOverrides: ExchangeRateOverride[];
    accountOrder: string[]; // List of account IDs in order
}

// Default languages
const defaultLanguages: LanguageConfig[] = [
    { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭', enabled: true },
    { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', enabled: true },
    { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', enabled: false },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', enabled: false },
    { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', enabled: false },
];

// Default settings
const defaultAssetTypes: AssetTypeConfig[] = [
    { id: 'stock', name: 'หุ้นไทย', nameEn: 'Thai Stock', color: 'bg-blue-500', icon: '📈', enabled: true },
    { id: 'foreign_stock', name: 'หุ้นต่างประเทศ', nameEn: 'Foreign Stock', color: 'bg-purple-500', icon: '🌍', enabled: true },
    { id: 'crypto', name: 'คริปโต', nameEn: 'Crypto', color: 'bg-orange-500', icon: '₿', enabled: true },
    { id: 'gold', name: 'ทองคำ', nameEn: 'Gold', color: 'bg-yellow-500', icon: '🥇', enabled: true },
    { id: 'tfex', name: 'TFEX', nameEn: 'TFEX', color: 'bg-red-500', icon: '📊', enabled: true },
    { id: 'commodity', name: 'สินค้าโภคภัณฑ์', nameEn: 'Commodity', color: 'bg-green-500', icon: '🛢️', enabled: true },
];

const defaultMarkets: MarketConfig[] = [
    { id: 'set', name: 'ตลาดหลักทรัพย์', nameEn: 'SET', assetType: 'stock', currency: 'THB', enabled: true, priceSource: 'https://marketdata.set.or.th' },
    { id: 'mai', name: 'MAI', nameEn: 'MAI', assetType: 'stock', currency: 'THB', enabled: true, priceSource: 'https://marketdata.set.or.th' },
    { id: 'nyse', name: 'NYSE', nameEn: 'NYSE', assetType: 'foreign_stock', currency: 'USD', enabled: true, priceSource: 'https://query1.finance.yahoo.com' },
    { id: 'nasdaq', name: 'NASDAQ', nameEn: 'NASDAQ', assetType: 'foreign_stock', currency: 'USD', enabled: true, priceSource: 'https://query1.finance.yahoo.com' },
    { id: 'binance', name: 'Binance', nameEn: 'Binance', assetType: 'crypto', currency: 'USD', enabled: true, priceSource: 'https://api.coingecko.com' },
    { id: 'bitkub', name: 'Bitkub', nameEn: 'Bitkub', assetType: 'crypto', currency: 'THB', enabled: true, priceSource: 'https://api.bitkub.com' },
    { id: 'tfex', name: 'TFEX', nameEn: 'TFEX', assetType: 'tfex', currency: 'THB', enabled: true, priceSource: 'https://marketdata.set.or.th' },
    { id: 'comex', name: 'COMEX', nameEn: 'COMEX', assetType: 'gold', currency: 'USD', enabled: true, priceSource: 'https://www.goldapi.io' },
    { id: 'lbma', name: 'LBMA', nameEn: 'LBMA', assetType: 'gold', currency: 'USD', enabled: true, priceSource: 'https://www.goldapi.io' },
    { id: 'goldtrader', name: 'ทองคำไทย', nameEn: 'Thai Gold', assetType: 'gold', currency: 'THB', enabled: true, priceSource: 'https://www.goldtraders.or.th' },
    { id: 'local', name: 'ทั่วไป (ในประเทศ)', nameEn: 'Local (Domestic)', assetType: 'gold', currency: 'THB', enabled: true, priceSource: '' },
];

const defaultCurrencies: CurrencyConfig[] = [
    { code: 'THB', name: 'บาท', symbol: '฿', enabled: true },
    { code: 'USD', name: 'ดอลลาร์สหรัฐ', symbol: '$', enabled: true },
    { code: 'BTC', name: 'บิทคอยน์', symbol: '₿', enabled: true },
    { code: 'EUR', name: 'ยูโร', symbol: '€', enabled: true },
    { code: 'GBP', name: 'ปอนด์', symbol: '£', enabled: true },
    { code: 'JPY', name: 'เยน', symbol: '¥', enabled: true },
    { code: 'HKD', name: 'ฮ่องกง', symbol: 'HK$', enabled: true },
    { code: 'SGD', name: 'สิงคโปร์', symbol: 'S$', enabled: true },
    { code: 'USDT', name: 'Tether', symbol: '₮', enabled: true },
    { code: 'USDC', name: 'USD Coin', symbol: 'Ⓢ', enabled: true },
];

const defaultSettings: AppSettings = {
    language: 'th',
    theme: 'dark',
    defaultCurrency: 'THB',
    defaultAssetType: 'stock',
    displayCurrency: 'THB',
    languages: defaultLanguages,
    assetTypes: defaultAssetTypes,
    markets: defaultMarkets,
    currencies: defaultCurrencies,
    exchangeRateOverrides: [],
    accountOrder: [],
};

// Context
interface SettingsContextType {
    settings: AppSettings;
    updateSettings: (updates: Partial<AppSettings>) => void;
    resetSettings: () => void;
    t: (thText: string, enText: string) => string;
    currentLanguage: LanguageConfig | undefined;
    displayCurrency: 'THB' | 'USD' | 'BTC';
    setDisplayCurrency: (currency: 'THB' | 'USD' | 'BTC') => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Provider
export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load settings from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('appSettings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Merge markets with defaults to include new fields like priceSource
                const mergedMarkets = (parsed.markets || defaultMarkets).map((market: MarketConfig) => {
                    const defaultMarket = defaultMarkets.find(dm => dm.id === market.id);
                    return {
                        ...market,
                        // If priceSource is missing, get it from defaults
                        priceSource: market.priceSource || defaultMarket?.priceSource || '',
                    };
                });
                // Merge with defaults to ensure new fields are included
                setSettings({
                    ...defaultSettings,
                    ...parsed,
                    languages: parsed.languages || defaultLanguages,
                    markets: mergedMarkets,
                });
            } catch (e) {
                console.error('Failed to parse settings:', e);
            }
        }
        setIsLoaded(true);
    }, []);

    // Save settings to localStorage
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('appSettings', JSON.stringify(settings));
        }
    }, [settings, isLoaded]);

    const updateSettings = (updates: Partial<AppSettings>) => {
        setSettings(prev => ({ ...prev, ...updates }));
    };

    const resetSettings = () => {
        setSettings(defaultSettings);
        localStorage.removeItem('appSettings');
    };

    // Get current language config
    const currentLanguage = settings.languages.find(l => l.code === settings.language);

    // Translation helper - supports th/en, defaults to en for other languages
    const t = (thText: string, enText: string): string => {
        return settings.language === 'th' ? thText : enText;
    };

    // Display currency helpers
    const displayCurrency = settings.displayCurrency;
    const setDisplayCurrency = (currency: 'THB' | 'USD' | 'BTC') => {
        updateSettings({ displayCurrency: currency });
    };

    if (!isLoaded) {
        return null;
    }

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, resetSettings, t, currentLanguage, displayCurrency, setDisplayCurrency }}>
            {children}
        </SettingsContext.Provider>
    );
}

// Hook
export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within SettingsProvider');
    }
    return context;
}
