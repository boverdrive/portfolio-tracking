'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useSettings, MarketConfig } from '@/contexts/SettingsContext';
import { useAuth } from '@/lib/auth';

// Settings section components
function LanguageSettings() {
    const { settings, updateSettings, t, currentLanguage } = useSettings();

    const toggleLanguage = (code: string) => {
        const updated = settings.languages.map(l =>
            l.code === code ? { ...l, enabled: !l.enabled } : l
        );
        updateSettings({ languages: updated });
    };

    const enabledLanguages = settings.languages.filter(l => l.enabled);

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                🌐 {t('ภาษา', 'Language')}
            </h3>

            {/* Language Selector Dropdown */}
            <div>
                <label className="block text-sm text-gray-400 mb-2">
                    {t('ภาษาที่ใช้แสดงผล', 'Display Language')}
                </label>
                <div className="relative">
                    <select
                        value={settings.language}
                        onChange={(e) => updateSettings({ language: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white appearance-none cursor-pointer"
                    >
                        {enabledLanguages.map(lang => (
                            <option key={lang.code} value={lang.code}>
                                {lang.flag} {lang.nativeName} ({lang.name})
                            </option>
                        ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
                {currentLanguage && (
                    <p className="mt-2 text-sm text-gray-500">
                        {t('กำลังใช้:', 'Currently using:')} {currentLanguage.flag} {currentLanguage.nativeName}
                    </p>
                )}
            </div>

            {/* Manage Available Languages */}
            <div>
                <label className="block text-sm text-gray-400 mb-2">
                    {t('ภาษาที่รองรับ', 'Available Languages')}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {settings.languages.map(lang => (
                        <div
                            key={lang.code}
                            onClick={() => toggleLanguage(lang.code)}
                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${lang.enabled
                                ? 'bg-gray-800/50 border-gray-600'
                                : 'bg-gray-900/50 border-gray-800 opacity-50'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-lg">{lang.flag}</span>
                                <span className="text-white text-sm">{lang.nativeName}</span>
                            </div>
                            {lang.enabled && (
                                <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function DefaultSettings() {
    const { settings, updateSettings, t } = useSettings();

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                ⚙️ {t('ค่าเริ่มต้น', 'Defaults')}
            </h3>

            <div className="space-y-3">
                <div>
                    <label className="block text-sm text-gray-400 mb-2">
                        {t('สกุลเงินเริ่มต้น', 'Default Currency')}
                    </label>
                    <select
                        value={settings.defaultCurrency}
                        onChange={(e) => updateSettings({ defaultCurrency: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                    >
                        {settings.currencies.filter(c => c.enabled).map(c => (
                            <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm text-gray-400 mb-2">
                        {t('ประเภทสินทรัพย์เริ่มต้น', 'Default Asset Type')}
                    </label>
                    <select
                        value={settings.defaultAssetType}
                        onChange={(e) => updateSettings({ defaultAssetType: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                    >
                        {settings.assetTypes.filter(a => a.enabled).map(a => (
                            <option key={a.id} value={a.id}>
                                {a.icon} {settings.language === 'th' ? a.name : a.nameEn}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}

function AssetTypeSettings() {
    const { settings, updateSettings, t } = useSettings();

    const toggleAssetType = (id: string) => {
        const updated = settings.assetTypes.map(a =>
            a.id === id ? { ...a, enabled: !a.enabled } : a
        );
        updateSettings({ assetTypes: updated });
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                📊 {t('ประเภทสินทรัพย์', 'Asset Types')}
            </h3>

            <div className="space-y-2">
                {settings.assetTypes.map(asset => (
                    <div
                        key={asset.id}
                        className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-xl">{asset.icon}</span>
                            <div>
                                <div className="text-white font-medium">
                                    {settings.language === 'th' ? asset.name : asset.nameEn}
                                </div>
                                <div className="text-xs text-gray-500">{asset.id}</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={asset.enabled}
                                onChange={() => toggleAssetType(asset.id)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MarketSettings() {
    const { settings, updateSettings, t } = useSettings();
    const [filterAssetType, setFilterAssetType] = useState<string>('all');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMarket, setEditingMarket] = useState<MarketConfig | null>(null);
    const [formData, setFormData] = useState({
        id: '',
        name: '',
        nameEn: '',
        assetType: 'stock',
        currency: 'THB',
        enabled: true,
        priceSource: '',
    });

    const toggleMarket = (id: string) => {
        const updated = settings.markets.map(m =>
            m.id === id ? { ...m, enabled: !m.enabled } : m
        );
        updateSettings({ markets: updated });
    };

    const filteredMarkets = filterAssetType === 'all'
        ? settings.markets
        : settings.markets.filter(m => m.assetType === filterAssetType);

    const openAddModal = () => {
        setEditingMarket(null);
        setFormData({
            id: '',
            name: '',
            nameEn: '',
            assetType: 'stock',
            currency: 'THB',
            enabled: true,
            priceSource: '',
        });
        setIsModalOpen(true);
    };

    const openEditModal = (market: MarketConfig) => {
        setEditingMarket(market);
        setFormData({
            id: market.id,
            name: market.name,
            nameEn: market.nameEn,
            assetType: market.assetType,
            currency: market.currency,
            enabled: market.enabled,
            priceSource: market.priceSource || '',
        });
        setIsModalOpen(true);
    };

    const handleSave = () => {
        if (!formData.id || !formData.name || !formData.nameEn) return;

        if (editingMarket) {
            // Edit existing
            const updated = settings.markets.map(m =>
                m.id === editingMarket.id ? { ...formData } : m
            );
            updateSettings({ markets: updated });
        } else {
            // Add new
            const exists = settings.markets.some(m => m.id === formData.id.toLowerCase());
            if (exists) {
                alert(t('ID นี้มีอยู่แล้ว', 'This ID already exists'));
                return;
            }
            updateSettings({
                markets: [...settings.markets, { ...formData, id: formData.id.toLowerCase() }]
            });
        }
        setIsModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (confirm(t('ต้องการลบตลาดนี้?', 'Delete this market?'))) {
            const updated = settings.markets.filter(m => m.id !== id);
            updateSettings({ markets: updated });
        }
    };

    const assetTypeOptions = [
        { value: 'all', label: t('ทั้งหมด', 'All') },
        ...settings.assetTypes.map(at => ({
            value: at.id,
            label: settings.language === 'th' ? at.name : at.nameEn,
        })),
    ];

    const currencyOptions = settings.currencies.filter(c => c.enabled).map(c => c.code);

    // API Status Check
    const [apiStatus, setApiStatus] = useState<Record<string, 'checking' | 'online' | 'offline' | 'unknown'>>({});

    const checkApiStatus = async (marketId: string, url: string) => {
        if (!url) return;
        setApiStatus(prev => ({ ...prev, [marketId]: 'checking' }));
        try {
            // Use backend proxy to check API status (avoid CORS issues)
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/health-check?url=${encodeURIComponent(url)}`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000),
            });
            const data = await response.json();
            setApiStatus(prev => ({ ...prev, [marketId]: data.status === 'ok' ? 'online' : 'offline' }));
        } catch {
            // If proxy fails, try HEAD request directly (may fail due to CORS)
            try {
                const response = await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(5000) });
                setApiStatus(prev => ({ ...prev, [marketId]: 'online' }));
            } catch {
                setApiStatus(prev => ({ ...prev, [marketId]: 'offline' }));
            }
        }
    };

    const checkAllApis = () => {
        filteredMarkets.forEach(market => {
            if (market.priceSource) {
                checkApiStatus(market.id, market.priceSource);
            }
        });
    };

    const getStatusIndicator = (marketId: string) => {
        const status = apiStatus[marketId];
        switch (status) {
            case 'checking':
                return <span className="inline-flex items-center gap-1 text-yellow-400 text-xs"><span className="animate-spin">⏳</span></span>;
            case 'online':
                return <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">🟢 Online</span>;
            case 'offline':
                return <span className="inline-flex items-center gap-1 text-rose-400 text-xs">🔴 Offline</span>;
            default:
                return <span className="inline-flex items-center gap-1 text-gray-500 text-xs">⚪ Unknown</span>;
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    🏛️ {t('ตลาด', 'Markets')}
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={checkAllApis}
                        className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-blue-400 text-sm transition-all flex items-center gap-1"
                    >
                        📡 {t('ตรวจสอบ API', 'Check APIs')}
                    </button>
                    <button
                        onClick={openAddModal}
                        className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm transition-all flex items-center gap-1"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {t('เพิ่ม', 'Add')}
                    </button>
                </div>
            </div>

            {/* Filter by Asset Type */}
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">{t('กรอง:', 'Filter:')}</span>
                <select
                    value={filterAssetType}
                    onChange={(e) => setFilterAssetType(e.target.value)}
                    className="px-3 py-1.5 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white text-sm"
                >
                    {assetTypeOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
                <span className="text-sm text-gray-500">
                    ({filteredMarkets.length} {t('รายการ', 'items')})
                </span>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredMarkets.map(market => (
                    <div
                        key={market.id}
                        className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-white font-medium">
                                    {settings.language === 'th' ? market.name : market.nameEn}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">({market.id})</span>
                                <span className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                                    {settings.assetTypes.find(a => a.id === market.assetType)?.[settings.language === 'th' ? 'name' : 'nameEn'] || market.assetType}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                                    {market.currency}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => openEditModal(market)}
                                    className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
                                    title={t('แก้ไข', 'Edit')}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => handleDelete(market.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                                    title={t('ลบ', 'Delete')}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={market.enabled}
                                        onChange={() => toggleMarket(market.id)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>
                        </div>
                        {/* Price Source URL */}
                        {market.priceSource && (
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-xs text-gray-400">📡 API:</span>
                                    <a
                                        href={market.priceSource}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-400 hover:text-blue-300 truncate font-mono"
                                        title={market.priceSource}
                                    >
                                        {market.priceSource}
                                    </a>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                    {getStatusIndicator(market.id)}
                                    <button
                                        onClick={() => checkApiStatus(market.id, market.priceSource!)}
                                        className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
                                        title={t('ตรวจสอบ', 'Check')}
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {filteredMarkets.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                        {t('ไม่พบตลาด', 'No markets found')}
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
                        <h4 className="text-lg font-semibold text-white mb-4">
                            {editingMarket ? t('แก้ไขตลาด', 'Edit Market') : t('เพิ่มตลาดใหม่', 'Add New Market')}
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">ID</label>
                                <input
                                    type="text"
                                    value={formData.id}
                                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                                    disabled={!!editingMarket}
                                    placeholder="e.g., nyse, hkex"
                                    className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">{t('ชื่อ (ไทย)', 'Name (TH)')}</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="ตลาดหลักทรัพย์..."
                                        className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">{t('ชื่อ (EN)', 'Name (EN)')}</label>
                                    <input
                                        type="text"
                                        value={formData.nameEn}
                                        onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                                        placeholder="Stock Exchange..."
                                        className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">{t('ประเภทสินทรัพย์', 'Asset Type')}</label>
                                    <select
                                        value={formData.assetType}
                                        onChange={(e) => setFormData({ ...formData, assetType: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                    >
                                        {settings.assetTypes.map(at => (
                                            <option key={at.id} value={at.id}>
                                                {settings.language === 'th' ? at.name : at.nameEn}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">{t('สกุลเงิน', 'Currency')}</label>
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                    >
                                        {currencyOptions.map(code => (
                                            <option key={code} value={code}>{code}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {/* Price Source - Full Width */}
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">{t('แหล่งราคา (API URL)', 'Price Source (API URL)')}</label>
                                <input
                                    type="text"
                                    value={formData.priceSource}
                                    onChange={(e) => setFormData({ ...formData, priceSource: e.target.value })}
                                    placeholder="https://api.example.com"
                                    className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white font-mono text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                            >
                                {t('ยกเลิก', 'Cancel')}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!formData.id || !formData.name || !formData.nameEn}
                                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
                            >
                                {t('บันทึก', 'Save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CurrencySettings() {
    const { settings, updateSettings, t } = useSettings();

    const toggleCurrency = (code: string) => {
        const updated = settings.currencies.map(c =>
            c.code === code ? { ...c, enabled: !c.enabled } : c
        );
        updateSettings({ currencies: updated });
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                💰 {t('สกุลเงิน', 'Currencies')}
            </h3>

            <div className="grid grid-cols-2 gap-2">
                {settings.currencies.map(currency => (
                    <div
                        key={currency.code}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${currency.enabled
                            ? 'bg-gray-800/50 border-gray-600'
                            : 'bg-gray-900/50 border-gray-800 opacity-50'
                            }`}
                        onClick={() => toggleCurrency(currency.code)}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-mono">{currency.symbol}</span>
                            <span className="text-white">{currency.code}</span>
                        </div>
                        {currency.enabled && (
                            <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function SystemSettings() {
    const { t } = useSettings();
    const [seeding, setSeeding] = useState(false);
    const [seedResult, setSeedResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleSeed = async () => {
        if (!confirm(t('การ Seed จะทำการเพิ่มข้อมูล Symbol ตั้งต้นลงในฐานข้อมูล ยืนยัน?', 'Seed default symbols to database?'))) {
            return;
        }

        setSeeding(true);
        setSeedResult(null);
        try {
            // Import dynamically or use the one from api.ts if available in context
            const { seedSymbols } = await import('@/lib/api');
            const result = await seedSymbols();
            setSeedResult({ type: 'success', message: result.message });
        } catch (err) {
            setSeedResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to seed symbols' });
        } finally {
            setSeeding(false);
        }
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                🔧 {t('ระบบ', 'System')}
            </h3>

            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h4 className="text-white font-medium">{t('Seed Symbols', 'Seed Symbols')}</h4>
                        <p className="text-sm text-gray-400">
                            {t('เพิ่มข้อมูลหุ้น/เหรียญตั้งต้น (Thai Stock, Crypto, TFEX, Foreign Stock) ลง Database', 'Populate database with default symbols')}
                        </p>
                    </div>
                    <button
                        onClick={handleSeed}
                        disabled={seeding}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 rounded-lg text-white text-sm transition-all flex items-center gap-2"
                    >
                        {seeding ? (
                            <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Seeding...
                            </>
                        ) : (
                            <>
                                📂 Seed DB
                            </>
                        )}
                    </button>
                </div>

                {seedResult && (
                    <div className={`mt-3 px-3 py-2 rounded-lg text-sm ${seedResult.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                        {seedResult.message}
                    </div>
                )}
            </div>
        </div>
    );
}

function ResetSettings() {
    const { resetSettings, t } = useSettings();

    const handleReset = () => {
        if (confirm(t('ต้องการรีเซ็ตการตั้งค่าทั้งหมด?', 'Reset all settings?'))) {
            resetSettings();
        }
    };

    return (
        <div className="pt-4 border-t border-gray-700">
            <button
                onClick={handleReset}
                className="w-full py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg font-medium transition-all"
            >
                🔄 {t('รีเซ็ตเป็นค่าเริ่มต้น', 'Reset to Defaults')}
            </button>
        </div>
    );
}

function ExchangeRateSettings() {
    const { t } = useSettings();
    const [rates, setRates] = useState<Record<string, number>>({});
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [baseCurrency, setBaseCurrency] = useState<'THB' | 'USD' | 'BTC' | 'XAU'>('THB');

    const fetchRates = async (base: string = baseCurrency) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/exchange-rate/${base}`);
            if (!response.ok) throw new Error('Failed to fetch rates');
            const data = await response.json();
            setRates(data.rates || {});
            setUpdatedAt(data.updated_at || new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch exchange rates');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRates(baseCurrency);
    }, [baseCurrency]);

    const formatDateTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleString('th-TH', {
            dateStyle: 'medium',
            timeStyle: 'medium',
        });
    };

    const currencyFlags: Record<string, string> = {
        THB: '🇹🇭',
        USD: '🇺🇸',
        EUR: '🇪🇺',
        GBP: '🇬🇧',
        BTC: '₿',
        JPY: '🇯🇵',
        CNY: '🇨🇳',
        XAU: '🥇',
    };

    const baseCurrencies = [
        { code: 'THB' as const, name: 'Thai Baht', flag: '🇹🇭' },
        { code: 'USD' as const, name: 'US Dollar', flag: '🇺🇸' },
        { code: 'BTC' as const, name: 'Bitcoin', flag: '₿' },
        { code: 'XAU' as const, name: 'Gold', flag: '🥇' },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    💱 {t('อัตราแลกเปลี่ยน', 'Exchange Rates')}
                </h3>
                <button
                    onClick={() => fetchRates(baseCurrency)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                >
                    <svg
                        className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {isLoading ? t('กำลังโหลด...', 'Loading...') : t('รีเฟรช', 'Refresh')}
                </button>
            </div>

            {/* Last Updated */}
            {updatedAt && (
                <p className="text-sm text-gray-500">
                    {t('อัปเดตล่าสุด:', 'Last updated:')} {formatDateTime(updatedAt)}
                </p>
            )}

            {/* Base Currency Tabs */}
            <div className="flex gap-2">
                {baseCurrencies.map((curr) => (
                    <button
                        key={curr.code}
                        onClick={() => setBaseCurrency(curr.code)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${baseCurrency === curr.code
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                            : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-600/30'
                            }`}
                    >
                        <span>{curr.flag}</span>
                        <span>{curr.code}</span>
                    </button>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* Rates Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(rates).map(([currency, rate]) => (
                    <div
                        key={currency}
                        className="bg-gray-700/30 rounded-lg p-3 border border-gray-600/30"
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">{currencyFlags[currency] || '💰'}</span>
                            <span className="text-white font-medium">{currency}</span>
                        </div>
                        <div className="text-gray-400 text-sm font-mono">
                            1 {baseCurrency} = {
                                rate < 0.000001
                                    ? rate.toExponential(4)
                                    : rate < 0.01
                                        ? rate.toFixed(10)
                                        : rate >= 1000
                                            ? rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                            : rate.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })
                            } {currency}
                        </div>
                    </div>
                ))}
            </div>

            {/* Empty state */}
            {!isLoading && Object.keys(rates).length === 0 && !error && (
                <div className="text-center py-6 text-gray-500">
                    <p>{t('ไม่พบข้อมูลอัตราแลกเปลี่ยน', 'No exchange rate data available')}</p>
                </div>
            )}
        </div>
    );
}

export default function SettingsPage() {
    const { t } = useSettings();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'general' | 'master'>('general');

    const tabs = [
        { id: 'general' as const, label: t('ทั่วไป', 'General'), icon: '⚙️' },
        { id: 'master' as const, label: t('Master Data', 'Master Data'), icon: '📋' },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Top Navigation Bar */}
            <Header currentPage="settings" />

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Quick Links */}
                <div className="mb-6 flex flex-wrap gap-3">
                    <Link
                        href="/settings/jobs"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 rounded-lg text-gray-300 hover:text-white transition-all"
                    >
                        ⚙️ {t('Background Jobs', 'Background Jobs')}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>
                    <Link
                        href="/settings/prices"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 rounded-lg text-gray-300 hover:text-white transition-all"
                    >
                        💰 {t('จัดการราคา', 'Manage Prices')}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>
                    {user?.role === 'admin' && (
                        <Link
                            href="/admin/users"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-800/50 hover:bg-purple-700/50 border border-purple-700/50 rounded-lg text-purple-300 hover:text-white transition-all"
                        >
                            👥 {t('จัดการผู้ใช้', 'Manage Users')}
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </Link>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === tab.id
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
                                }`}
                        >
                            <span>{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 space-y-6">
                    {activeTab === 'general' ? (
                        <>
                            <LanguageSettings />
                            <hr className="border-gray-700" />
                            <DefaultSettings />
                            <hr className="border-gray-700" />
                            <ExchangeRateSettings />
                            <hr className="border-gray-700" />
                            <ResetSettings />
                        </>
                    ) : (
                        <>
                            <AssetTypeSettings />
                            <hr className="border-gray-700" />
                            <MarketSettings />
                            <hr className="border-gray-700" />
                            <CurrencySettings />
                            <hr className="border-gray-700" />
                            <SystemSettings />
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
