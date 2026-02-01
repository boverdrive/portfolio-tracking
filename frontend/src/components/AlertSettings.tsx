'use client';

import { useState, useEffect } from 'react';
import {
    getAlerts,
    createAlert,
    updateAlert,
    deleteAlert,
    getAlertHistory,
    sendTestNotification,
    AlertRule,
    AlertType,
    Comparison,
    NotificationChannel,
    CreateAlertRequest,
    AlertHistory,
    getAlertTypeName,
    getChannelName,
} from '@/lib/api';

interface AlertSettingsProps {
    className?: string;
}

export default function AlertSettings({ className = '' }: AlertSettingsProps) {
    const [alerts, setAlerts] = useState<AlertRule[]>([]);
    const [history, setHistory] = useState<AlertHistory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editingAlert, setEditingAlert] = useState<AlertRule | null>(null);
    const [testingNotification, setTestingNotification] = useState(false);

    // Fetch alerts
    useEffect(() => {
        fetchAlerts();
    }, []);

    const fetchAlerts = async () => {
        setLoading(true);
        try {
            const data = await getAlerts();
            setAlerts(data);
        } catch (error) {
            console.error('Failed to fetch alerts:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            const data = await getAlertHistory(50);
            setHistory(data);
        } catch (error) {
            console.error('Failed to fetch history:', error);
        }
    };

    const handleToggleActive = async (alert: AlertRule) => {
        try {
            await updateAlert(alert.id, { is_active: !alert.is_active });
            setAlerts(prev => prev.map(a =>
                a.id === alert.id ? { ...a, is_active: !a.is_active } : a
            ));
        } catch (error) {
            console.error('Failed to toggle alert:', error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('ต้องการลบการแจ้งเตือนนี้?')) return;
        try {
            await deleteAlert(id);
            setAlerts(prev => prev.filter(a => a.id !== id));
        } catch (error) {
            console.error('Failed to delete alert:', error);
        }
    };

    const handleTestNotification = async () => {
        setTestingNotification(true);
        try {
            await sendTestNotification();
            alert('ส่งการแจ้งเตือนทดสอบแล้ว!');
        } catch (error) {
            console.error('Failed to send test notification:', error);
            alert('ไม่สามารถส่งการแจ้งเตือนทดสอบได้');
        } finally {
            setTestingNotification(false);
        }
    };

    const openHistory = () => {
        fetchHistory();
        setShowHistoryModal(true);
    };

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        🔔 การแจ้งเตือน (Alerts)
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        ตั้งค่าการแจ้งเตือนเมื่อราคาถึงเป้าหมายหรือพอร์ตเปลี่ยนแปลง
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleTestNotification}
                        disabled={testingNotification}
                        className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                    >
                        {testingNotification ? 'กำลังส่ง...' : '🧪 ทดสอบ'}
                    </button>
                    <button
                        onClick={openHistory}
                        className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                        📜 ประวัติ
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        + สร้าง Alert
                    </button>
                </div>
            </div>

            {/* Alert List */}
            {loading ? (
                <div className="text-center py-8 text-gray-500">กำลังโหลด...</div>
            ) : alerts.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                    <div className="text-4xl mb-3">🔕</div>
                    <p className="text-gray-600 dark:text-gray-400">ยังไม่มีการแจ้งเตือน</p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="mt-4 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                        สร้างการแจ้งเตือนแรก →
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {alerts.map((alert) => (
                        <AlertCard
                            key={alert.id}
                            alert={alert}
                            onToggle={() => handleToggleActive(alert)}
                            onEdit={() => {
                                setEditingAlert(alert);
                                setShowCreateModal(true);
                            }}
                            onDelete={() => handleDelete(alert.id)}
                        />
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showCreateModal && (
                <AlertFormModal
                    alert={editingAlert}
                    onClose={() => {
                        setShowCreateModal(false);
                        setEditingAlert(null);
                    }}
                    onSave={async (data) => {
                        if (editingAlert) {
                            await updateAlert(editingAlert.id, data);
                        } else {
                            await createAlert(data as CreateAlertRequest);
                        }
                        await fetchAlerts();
                        setShowCreateModal(false);
                        setEditingAlert(null);
                    }}
                />
            )}

            {/* History Modal */}
            {showHistoryModal && (
                <HistoryModal
                    history={history}
                    onClose={() => setShowHistoryModal(false)}
                />
            )}
        </div>
    );
}

// Alert Card Component
function AlertCard({
    alert,
    onToggle,
    onEdit,
    onDelete,
}: {
    alert: AlertRule;
    onToggle: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <div className={`p-4 rounded-xl border ${alert.is_active
            ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
            }`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Toggle */}
                    <button
                        onClick={onToggle}
                        className={`relative w-12 h-6 rounded-full transition-colors ${alert.is_active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                    >
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${alert.is_active ? 'left-7' : 'left-1'
                            }`} />
                    </button>

                    {/* Info */}
                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">
                            {alert.name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {getAlertTypeName(alert.alert_type)}
                            {alert.symbol && `: ${alert.symbol}`}
                            {' • '}
                            {alert.comparison === 'above' ? '≥' : alert.comparison === 'below' ? '≤' : '='}{' '}
                            {alert.threshold.toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Channels & Actions */}
                <div className="flex items-center gap-4">
                    {/* Channels */}
                    <div className="flex gap-1">
                        {alert.channels.includes('in_app') && (
                            <span className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                                In-App
                            </span>
                        )}
                        {alert.channels.includes('web_push') && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                Push
                            </span>
                        )}
                        {alert.channels.includes('email') && (
                            <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                                Email
                            </span>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1">
                        <button
                            onClick={onEdit}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            ✏️
                        </button>
                        <button
                            onClick={onDelete}
                            className="p-2 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            🗑️
                        </button>
                    </div>
                </div>
            </div>

            {/* Last Triggered */}
            {alert.last_triggered && (
                <p className="mt-2 text-xs text-gray-400">
                    แจ้งเตือนครั้งล่าสุด: {new Date(alert.last_triggered).toLocaleString('th-TH')}
                </p>
            )}
        </div>
    );
}

// Alert Form Modal
function AlertFormModal({
    alert,
    onClose,
    onSave,
}: {
    alert: AlertRule | null;
    onClose: () => void;
    onSave: (data: CreateAlertRequest | Partial<CreateAlertRequest>) => Promise<void>;
}) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: alert?.name || '',
        alert_type: alert?.alert_type || 'price_above' as AlertType,
        symbol: alert?.symbol || '',
        threshold: alert?.threshold || 0,
        comparison: alert?.comparison || 'above' as Comparison,
        channels: alert?.channels || ['in_app'] as NotificationChannel[],
        cooldown_minutes: alert?.cooldown_minutes || 60,
    });

    const alertTypes: { value: AlertType; label: string }[] = [
        { value: 'price_above', label: '📈 ราคาสูงกว่า' },
        { value: 'price_below', label: '📉 ราคาต่ำกว่า' },
        { value: 'pnl_threshold_percent', label: '💰 กำไร/ขาดทุน (%)' },
        { value: 'portfolio_change_percent', label: '📊 พอร์ตเปลี่ยนแปลง (%)' },
        { value: 'daily_pnl_report', label: '📅 สรุปรายวัน' },
    ];

    const toggleChannel = (channel: NotificationChannel) => {
        setForm(prev => ({
            ...prev,
            channels: prev.channels.includes(channel)
                ? prev.channels.filter(c => c !== channel)
                : [...prev.channels, channel]
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || form.channels.length === 0) {
            window.alert('กรุณากรอกข้อมูลให้ครบถ้วน');
            return;
        }

        setSaving(true);
        try {
            await onSave({
                name: form.name,
                alert_type: form.alert_type,
                symbol: form.symbol || undefined,
                threshold: form.threshold,
                comparison: form.comparison,
                channels: form.channels,
                cooldown_minutes: form.cooldown_minutes,
            });
        } catch (error) {
            console.error('Failed to save alert:', error);
        } finally {
            setSaving(false);
        }
    };

    const needsSymbol = ['price_above', 'price_below'].includes(form.alert_type);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {alert ? 'แก้ไขการแจ้งเตือน' : 'สร้างการแจ้งเตือนใหม่'}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-4 space-y-4">
                        {/* Name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                ชื่อการแจ้งเตือน
                            </label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="เช่น BTC ถึง 50K"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>

                        {/* Alert Type */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                ประเภท
                            </label>
                            <select
                                value={form.alert_type}
                                onChange={(e) => setForm(prev => ({ ...prev, alert_type: e.target.value as AlertType }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                            >
                                {alertTypes.map(type => (
                                    <option key={type.value} value={type.value}>{type.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Symbol (conditional) */}
                        {needsSymbol && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    สัญลักษณ์ (Symbol)
                                </label>
                                <input
                                    type="text"
                                    value={form.symbol}
                                    onChange={(e) => setForm(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                                    placeholder="เช่น BTC, NVDA, PTT"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                    required={needsSymbol}
                                />
                            </div>
                        )}

                        {/* Threshold */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                เกณฑ์ (Threshold)
                            </label>
                            <input
                                type="number"
                                value={form.threshold}
                                onChange={(e) => setForm(prev => ({ ...prev, threshold: parseFloat(e.target.value) || 0 }))}
                                step="any"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>

                        {/* Comparison */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                เงื่อนไข
                            </label>
                            <div className="flex gap-2">
                                {(['above', 'below', 'equals'] as Comparison[]).map(comp => (
                                    <button
                                        key={comp}
                                        type="button"
                                        onClick={() => setForm(prev => ({ ...prev, comparison: comp }))}
                                        className={`flex-1 py-2 rounded-lg border transition-colors ${form.comparison === comp
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {comp === 'above' ? '≥ มากกว่า' : comp === 'below' ? '≤ น้อยกว่า' : '= เท่ากับ'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Channels */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                ช่องทางแจ้งเตือน
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => toggleChannel('in_app')}
                                    className={`px-4 py-2 rounded-lg border transition-colors ${form.channels.includes('in_app')
                                        ? 'bg-purple-600 text-white border-purple-600'
                                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                        }`}
                                >
                                    📱 In-App
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleChannel('web_push')}
                                    className={`px-4 py-2 rounded-lg border transition-colors ${form.channels.includes('web_push')
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                        }`}
                                >
                                    🔔 Browser Push
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleChannel('email')}
                                    className={`px-4 py-2 rounded-lg border transition-colors ${form.channels.includes('email')
                                        ? 'bg-green-600 text-white border-green-600'
                                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                        }`}
                                >
                                    ✉️ Email
                                </button>
                            </div>
                        </div>

                        {/* Cooldown */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Cooldown (นาที)
                            </label>
                            <select
                                value={form.cooldown_minutes}
                                onChange={(e) => setForm(prev => ({ ...prev, cooldown_minutes: parseInt(e.target.value) }))}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                            >
                                <option value={5}>5 นาที</option>
                                <option value={15}>15 นาที</option>
                                <option value={30}>30 นาที</option>
                                <option value={60}>1 ชั่วโมง</option>
                                <option value={240}>4 ชั่วโมง</option>
                                <option value={1440}>24 ชั่วโมง</option>
                            </select>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                ระยะรอระหว่างการแจ้งเตือนซ้ำ
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {saving ? 'กำลังบันทึก...' : alert ? 'บันทึก' : 'สร้าง'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// History Modal
function HistoryModal({
    history,
    onClose,
}: {
    history: AlertHistory[];
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        📜 ประวัติการแจ้งเตือน
                    </h2>
                    <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto max-h-96 p-4">
                    {history.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <div className="text-4xl mb-2">📭</div>
                            <p>ยังไม่มีประวัติการแจ้งเตือน</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {history.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                                >
                                    <p className="text-sm text-gray-900 dark:text-white">
                                        {item.message}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        <span>
                                            {new Date(item.triggered_at).toLocaleString('th-TH')}
                                        </span>
                                        <span>•</span>
                                        <span>
                                            ค่า: {item.value_at_trigger.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                        ปิด
                    </button>
                </div>
            </div>
        </div>
    );
}
