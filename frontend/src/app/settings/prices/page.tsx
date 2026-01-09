'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import { useSettings } from '@/contexts/SettingsContext';

interface AssetPrice {
    id: string;
    symbol: string;
    asset_type: string;
    price: number;
    currency: string;
    market?: string;
    last_updated?: string;
}

type SortColumn = 'symbol' | 'asset_type' | 'price' | 'currency' | 'market' | 'last_updated';
type SortDirection = 'asc' | 'desc';

export default function PricesSettingsPage() {
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const { t } = useSettings();
    const router = useRouter();
    const [prices, setPrices] = useState<AssetPrice[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editPrice, setEditPrice] = useState('');
    const [editMarket, setEditMarket] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [sortColumn, setSortColumn] = useState<SortColumn>('symbol');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [newPrice, setNewPrice] = useState({
        symbol: '',
        asset_type: 'stock',
        price: '',
        currency: 'THB',
        market: ''
    });

    const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090';

    const fetchPrices = useCallback(async () => {
        try {
            const response = await fetch(`${pbUrl}/api/collections/asset_prices/records?perPage=500`);
            if (response.ok) {
                const data = await response.json();
                setPrices(data.items || []);
            }
        } catch (error) {
            console.error('Error fetching prices:', error);
        } finally {
            setLoading(false);
        }
    }, [pbUrl]);

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push('/login');
            return;
        }
        if (isAuthenticated) {
            fetchPrices();
        }
    }, [isAuthenticated, authLoading, router, fetchPrices]);

    const handleEdit = (price: AssetPrice) => {
        setEditingId(price.id);
        setEditPrice(price.price.toString());
        setEditMarket(price.market || '');
    };

    const handleSave = async (price: AssetPrice) => {
        setSaving(true);
        try {
            const newPriceValue = parseFloat(editPrice);
            if (isNaN(newPriceValue)) {
                setMessage({ type: 'error', text: t('กรุณากรอกราคาที่ถูกต้อง', 'Please enter a valid price') });
                return;
            }

            const response = await fetch(`${pbUrl}/api/collections/asset_prices/records/${price.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    price: newPriceValue,
                    market: editMarket || null,
                    last_updated: new Date().toISOString()
                })
            });

            if (response.ok) {
                setMessage({ type: 'success', text: t(`อัปเดตราคา ${price.symbol} เรียบร้อย`, `Updated ${price.symbol} price successfully`) });
                setEditingId(null);
                fetchPrices();
            } else {
                setMessage({ type: 'error', text: t('ไม่สามารถอัปเดตราคาได้', 'Failed to update price') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: t('เกิดข้อผิดพลาด', 'An error occurred') });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const handleAddPrice = async () => {
        if (!newPrice.symbol || !newPrice.price) {
            setMessage({ type: 'error', text: t('กรุณากรอก Symbol และราคา', 'Please enter Symbol and Price') });
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(`${pbUrl}/api/collections/asset_prices/records`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: newPrice.symbol.toUpperCase(),
                    asset_type: newPrice.asset_type,
                    price: parseFloat(newPrice.price),
                    currency: newPrice.currency,
                    market: newPrice.market || null,
                    last_updated: new Date().toISOString()
                })
            });

            if (response.ok) {
                setMessage({ type: 'success', text: t(`เพิ่มราคา ${newPrice.symbol} เรียบร้อย`, `Added ${newPrice.symbol} price successfully`) });
                setShowAddForm(false);
                setNewPrice({ symbol: '', asset_type: 'stock', price: '', currency: 'THB', market: '' });
                fetchPrices();
            } else {
                setMessage({ type: 'error', text: t('ไม่สามารถเพิ่มราคาได้', 'Failed to add price') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: t('เกิดข้อผิดพลาด', 'An error occurred') });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const handleDelete = async (price: AssetPrice) => {
        if (!confirm(t(`ต้องการลบราคา ${price.symbol} หรือไม่?`, `Delete price for ${price.symbol}?`))) return;

        try {
            const response = await fetch(`${pbUrl}/api/collections/asset_prices/records/${price.id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                setMessage({ type: 'success', text: t(`ลบราคา ${price.symbol} เรียบร้อย`, `Deleted ${price.symbol} price`) });
                fetchPrices();
            } else {
                setMessage({ type: 'error', text: t('ไม่สามารถลบได้', 'Failed to delete') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: t('เกิดข้อผิดพลาด', 'An error occurred') });
        }
        setTimeout(() => setMessage(null), 3000);
    };

    // Sort toggle handler
    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Filter and sort prices
    const sortedPrices = useMemo(() => {
        const filtered = prices.filter(p =>
            p.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.asset_type.toLowerCase().includes(searchQuery.toLowerCase())
        );

        return filtered.sort((a, b) => {
            let aVal: string | number = '';
            let bVal: string | number = '';

            switch (sortColumn) {
                case 'symbol':
                    aVal = a.symbol.toLowerCase();
                    bVal = b.symbol.toLowerCase();
                    break;
                case 'asset_type':
                    aVal = a.asset_type.toLowerCase();
                    bVal = b.asset_type.toLowerCase();
                    break;
                case 'price':
                    aVal = a.price;
                    bVal = b.price;
                    break;
                case 'currency':
                    aVal = a.currency.toLowerCase();
                    bVal = b.currency.toLowerCase();
                    break;
                case 'market':
                    aVal = (a.market || '').toLowerCase();
                    bVal = (b.market || '').toLowerCase();
                    break;
                case 'last_updated':
                    aVal = a.last_updated || '';
                    bVal = b.last_updated || '';
                    break;
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [prices, searchQuery, sortColumn, sortDirection]);

    // Sortable header component
    const SortableHeader = ({ column, label, align = 'left' }: { column: SortColumn; label: string; align?: 'left' | 'right' | 'center' }) => (
        <th
            className={`px-6 py-4 text-${align} text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors select-none`}
            onClick={() => handleSort(column)}
        >
            <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
                <span>{label}</span>
                {sortColumn === column && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                        ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        )}
                    </svg>
                )}
            </div>
        </th>
    );

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString('th-TH');
    };

    const getAssetTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
            stock: t('หุ้นไทย', 'Thai Stock'),
            foreign_stock: t('หุ้นต่างประเทศ', 'Foreign Stock'),
            crypto: 'Crypto',
            gold: t('ทองคำ', 'Gold'),
            tfex: 'TFEX'
        };
        return labels[type] || type;
    };

    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Header */}
            <Header currentPage="settings" />

            <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Page Title */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link href="/settings" className="text-gray-400 hover:text-white transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white">💰 {t('จัดการราคาสินทรัพย์', 'Manage Asset Prices')}</h1>
                            <p className="text-gray-400 text-sm">{t('แก้ไขและตั้งราคาด้วยตนเอง', 'Manually edit and set prices')}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {t('เพิ่มราคาใหม่', 'Add New Price')}
                    </button>
                </div>

                {/* Message */}
                {message && (
                    <div className={`mb-4 p-4 rounded-lg ${message.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                        {message.text}
                    </div>
                )}

                {/* Add Form */}
                {showAddForm && (
                    <div className="mb-6 p-6 bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">{t('เพิ่มราคาใหม่', 'Add New Price')}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                            <input
                                type="text"
                                placeholder="Symbol"
                                value={newPrice.symbol}
                                onChange={(e) => setNewPrice({ ...newPrice, symbol: e.target.value })}
                                className="px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                            <select
                                value={newPrice.asset_type}
                                onChange={(e) => setNewPrice({ ...newPrice, asset_type: e.target.value })}
                                className="px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            >
                                <option value="stock">{t('หุ้นไทย', 'Thai Stock')}</option>
                                <option value="foreign_stock">{t('หุ้นต่างประเทศ', 'Foreign Stock')}</option>
                                <option value="crypto">Crypto</option>
                                <option value="gold">{t('ทองคำ', 'Gold')}</option>
                                <option value="tfex">TFEX</option>
                            </select>
                            <input
                                type="number"
                                placeholder={t('ราคา', 'Price')}
                                value={newPrice.price}
                                onChange={(e) => setNewPrice({ ...newPrice, price: e.target.value })}
                                className="px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                            <select
                                value={newPrice.currency}
                                onChange={(e) => setNewPrice({ ...newPrice, currency: e.target.value })}
                                className="px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            >
                                <option value="THB">THB</option>
                                <option value="USD">USD</option>
                                <option value="USDT">USDT</option>
                                <option value="BTC">BTC</option>
                            </select>
                            <input
                                type="text"
                                placeholder={t('Market (เช่น Binance)', 'Market (e.g., Binance)')}
                                value={newPrice.market}
                                onChange={(e) => setNewPrice({ ...newPrice, market: e.target.value })}
                                className="px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                            <button
                                onClick={handleAddPrice}
                                disabled={saving}
                                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                            >
                                {saving ? t('กำลังบันทึก...', 'Saving...') : t('เพิ่ม', 'Add')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="mb-6">
                    <input
                        type="text"
                        placeholder={t('ค้นหา Symbol หรือประเภท...', 'Search symbol or type...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full md:w-80 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                </div>

                {/* Prices Table */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-900/50">
                            <tr>
                                <SortableHeader column="symbol" label="Symbol" />
                                <SortableHeader column="asset_type" label={t('ประเภท', 'Type')} />
                                <SortableHeader column="price" label={t('ราคา', 'Price')} align="right" />
                                <SortableHeader column="currency" label={t('สกุลเงิน', 'Currency')} />
                                <SortableHeader column="market" label="Market" />
                                <SortableHeader column="last_updated" label={t('อัปเดตล่าสุด', 'Last Updated')} />
                                <th className="px-6 py-4 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">{t('จัดการ', 'Actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {sortedPrices.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                        {prices.length === 0 ? t('ยังไม่มีข้อมูลราคา', 'No price data yet') : t('ไม่พบข้อมูลที่ค้นหา', 'No results found')}
                                    </td>
                                </tr>
                            ) : (
                                sortedPrices.map((price) => (
                                    <tr key={price.id} className="hover:bg-gray-700/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <span className="font-mono font-semibold text-white">{price.symbol}</span>
                                            {price.market && <span className="ml-2 text-xs text-gray-500">{price.market}</span>}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-400">{getAssetTypeLabel(price.asset_type)}</td>
                                        <td className="px-6 py-4 text-right">
                                            {editingId === price.id ? (
                                                <input
                                                    type="number"
                                                    value={editPrice}
                                                    onChange={(e) => setEditPrice(e.target.value)}
                                                    className="w-32 px-2 py-1 bg-gray-700 border border-emerald-500 rounded text-white text-right font-mono focus:outline-none"
                                                    autoFocus
                                                />
                                            ) : (
                                                <span className="font-mono text-white">{price.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-400">{price.currency}</td>
                                        <td className="px-6 py-4 text-sm">
                                            {editingId === price.id ? (
                                                <input
                                                    type="text"
                                                    value={editMarket}
                                                    onChange={(e) => setEditMarket(e.target.value)}
                                                    placeholder="Market"
                                                    className="w-28 px-2 py-1 bg-gray-700 border border-emerald-500 rounded text-white text-sm focus:outline-none"
                                                />
                                            ) : (
                                                <span className="text-gray-500">{price.market || '-'}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">{formatDate(price.last_updated)}</td>
                                        <td className="px-6 py-4 text-center">
                                            {editingId === price.id ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleSave(price)}
                                                        disabled={saving}
                                                        className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded transition-colors"
                                                    >
                                                        {t('บันทึก', 'Save')}
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId(null)}
                                                        className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors"
                                                    >
                                                        {t('ยกเลิก', 'Cancel')}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleEdit(price)}
                                                        className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                                                        title="แก้ไข"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(price)}
                                                        className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                                                        title="ลบ"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Summary */}
                <div className="mt-4 text-sm text-gray-500">
                    {t('แสดง', 'Showing')} {sortedPrices.length} {t('จาก', 'of')} {prices.length} {t('รายการ', 'items')}
                </div>
            </main>
        </div>
    );
}
