'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useSettings } from '@/contexts/SettingsContext';

interface JobConfig {
    id: string;
    name: string;
    name_en: string;
    job_type: string;
    interval_seconds: number;
    enabled: boolean;
    status: string;
    last_run: string | null;
    next_run: string | null;
    schedule_times: string[] | null;
    last_result: any | null;
}

interface ApiStatusResult {
    market_id: string;
    market_name: string;
    url: string;
    status: string;
    response_time_ms: number | null;
    error_message: string | null;
}

const INTERVAL_OPTIONS = [
    { value: 3600, label: '1 ชั่วโมง', labelEn: '1 Hour' },
    { value: 21600, label: '6 ชั่วโมง', labelEn: '6 Hours' },
    { value: 43200, label: '12 ชั่วโมง', labelEn: '12 Hours' },
    { value: 86400, label: '1 วัน', labelEn: '1 Day' },
    { value: 604800, label: '1 สัปดาห์', labelEn: '1 Week' },
];

export default function JobsPage() {
    const { t } = useSettings();
    const [jobs, setJobs] = useState<JobConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedJob, setSelectedJob] = useState<JobConfig | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isRunning, setIsRunning] = useState<Record<string, boolean>>({});

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    // Fetch jobs
    const fetchJobs = async () => {
        try {
            const response = await fetch(`${API_URL}/api/jobs`);
            if (response.ok) {
                const data = await response.json();
                setJobs(data.jobs || []);
            }
        } catch (error) {
            console.error('Failed to fetch jobs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    // Update job
    const updateJob = async (id: string, updates: Partial<JobConfig>) => {
        try {
            // Optimistic update
            setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
            if (selectedJob?.id === id) {
                setSelectedJob(prev => prev ? { ...prev, ...updates } : null);
            }

            const response = await fetch(`${API_URL}/api/jobs/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (response.ok) {
                const updated = await response.json();
                setJobs(prev => prev.map(j => j.id === id ? updated : j));
                if (selectedJob?.id === id) {
                    setSelectedJob(updated);
                }
            } else {
                // Revert if failed (simplified, assuming refresh on manual fix)
                fetchJobs();
            }
        } catch (error) {
            console.error('Failed to update job:', error);
            fetchJobs();
        }
    };

    // Run job now
    const runJob = async (id: string) => {
        setIsRunning(prev => ({ ...prev, [id]: true }));
        try {
            const response = await fetch(`${API_URL}/api/jobs/${id}/run`, {
                method: 'POST',
            });
            if (response.ok) {
                await fetchJobs(); // Refresh to get latest status
            }
        } catch (error) {
            console.error('Failed to run job:', error);
        } finally {
            setIsRunning(prev => ({ ...prev, [id]: false }));
        }
    };

    // Format date
    const formatDateTime = (dateString: string | null) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleString('th-TH', {
            dateStyle: 'short',
            timeStyle: 'short',
        });
    };

    // Get status badge
    const getStatusBadge = (status: string) => {
        switch (status.toLowerCase()) {
            case 'running':
                return <span className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">⏳ Running</span>;
            case 'success':
                return <span className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded">✅ Success</span>;
            case 'failed':
                return <span className="px-2 py-1 text-xs bg-rose-500/20 text-rose-400 rounded">❌ Failed</span>;
            case 'disabled':
                return <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">⏸️ Disabled</span>;
            default:
                return <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">⚪ Idle</span>;
        }
    };

    // Get interval label
    const getIntervalLabel = (seconds: number) => {
        const option = INTERVAL_OPTIONS.find(o => o.value === seconds);
        if (option) return t(option.label, option.labelEn);

        if (seconds < 3600) return `${Math.round(seconds / 60)} ${t('นาที', 'min')}`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)} ${t('ชั่วโมง', 'hours')}`;
        return `${Math.round(seconds / 86400)} ${t('วัน', 'days')}`;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            <Header currentPage="settings" />

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
                    <Link href="/settings" className="hover:text-white">{t('ตั้งค่า', 'Settings')}</Link>
                    <span>/</span>
                    <span className="text-white">{t('Background Jobs', 'Background Jobs')}</span>
                </div>

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            ⚙️ {t('Background Jobs', 'Background Jobs')}
                        </h1>
                        <p className="text-gray-400 mt-1">
                            {t('จัดการงานที่ทำงานอัตโนมัติในเบื้องหลัง', 'Manage automated background tasks')}
                        </p>
                    </div>
                </div>

                {/* Jobs List */}
                <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden">
                    {isLoading ? (
                        <div className="p-8 text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto"></div>
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            <p>{t('ไม่พบ Background Jobs', 'No background jobs found')}</p>
                            <p className="text-sm mt-2">{t('Jobs จะถูกสร้างอัตโนมัติเมื่อ backend เริ่มทำงาน', 'Jobs will be created automatically when backend starts')}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-700/50">
                            {jobs.map(job => (
                                <div
                                    key={job.id}
                                    className="p-4 hover:bg-gray-700/20 transition-colors"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">
                                                {job.job_type === 'api_status_check' ? '📡' : '⚙️'}
                                            </span>
                                            <div>
                                                <h3 className="text-white font-medium">
                                                    {t(job.name, job.name_en)}
                                                </h3>
                                                <p className="text-xs text-gray-500 font-mono">{job.job_type}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {getStatusBadge(job.status)}
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={job.enabled}
                                                    onChange={(e) => updateJob(job.id, { enabled: e.target.checked })}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Job Details */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
                                        <div>
                                            <span className="text-gray-500">{t('ช่วงเวลา', 'Interval')}:</span>
                                            <span className="ml-2 text-white">
                                                {job.schedule_times && job.schedule_times.length > 0
                                                    ? `${job.schedule_times.length} times/day`
                                                    : getIntervalLabel(job.interval_seconds)
                                                }
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">{t('รันล่าสุด', 'Last Run')}:</span>
                                            <span className="ml-2 text-white">{formatDateTime(job.last_run)}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">{t('รันครั้งต่อไป', 'Next Run')}:</span>
                                            <span className="ml-2 text-white">{job.enabled ? formatDateTime(job.next_run) : '-'}</span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => runJob(job.id)}
                                            disabled={isRunning[job.id] || job.status === 'running'}
                                            className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-blue-400 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            {isRunning[job.id] || job.status === 'running' ? (
                                                <>
                                                    <span className="animate-spin">⏳</span>
                                                    {t('กำลังรัน...', 'Running...')}
                                                </>
                                            ) : (
                                                <>▶️ {t('รันเดี๋ยวนี้', 'Run Now')}</>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedJob(job);
                                                setIsModalOpen(true);
                                            }}
                                            className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 border border-gray-600/50 rounded-lg text-gray-300 text-sm transition-all flex items-center gap-1"
                                        >
                                            ⚙️ {t('ตั้งค่า', 'Config')}
                                        </button>
                                        {job.last_result && (
                                            <button
                                                onClick={() => {
                                                    setSelectedJob(job);
                                                    setIsModalOpen(true);
                                                }}
                                                className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm transition-all flex items-center gap-1"
                                            >
                                                📊 {t('ดูผลลัพธ์', 'View Results')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Job Config Modal */}
            {isModalOpen && selectedJob && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl border border-gray-700 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                ⚙️ {t(selectedJob.name, selectedJob.name_en)}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="text-gray-400 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Config Section */}
                        <div className="space-y-4 mb-6">
                            {/* Mode Toggle */}
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    {t('โหมดการทำงาน', 'Execution Mode')}
                                </label>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => updateJob(selectedJob.id, { schedule_times: null })}
                                        className={`px-4 py-2 rounded-lg text-sm transition-colors border ${!selectedJob.schedule_times
                                            ? 'bg-blue-600 border-blue-500 text-white'
                                            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                                            }`}
                                    >
                                        {t('วนซ้ำตามเวลา', 'Interval Loop')}
                                    </button>
                                    <button
                                        onClick={() => updateJob(selectedJob.id, { schedule_times: [] })}
                                        className={`px-4 py-2 rounded-lg text-sm transition-colors border ${selectedJob.schedule_times
                                            ? 'bg-blue-600 border-blue-500 text-white'
                                            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                                            }`}
                                    >
                                        {t('ระบุเวลาเจาะจง', 'Fixed Times')}
                                    </button>
                                </div>
                            </div>

                            {!selectedJob.schedule_times ? (
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        {t('ช่วงเวลาในการรัน', 'Run Interval')}
                                    </label>
                                    <select
                                        value={selectedJob.interval_seconds}
                                        onChange={(e) => {
                                            const newInterval = parseInt(e.target.value);
                                            updateJob(selectedJob.id, { interval_seconds: newInterval });
                                        }}
                                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                    >
                                        {INTERVAL_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>
                                                {t(opt.label, opt.labelEn)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        {t('เวลาที่ต้องการรัน (HH:MM)', 'Schedule Times (HH:MM)')}
                                    </label>
                                    <div className="space-y-2">
                                        {selectedJob.schedule_times.map((time, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                <input
                                                    type="time"
                                                    value={time}
                                                    onChange={(e) => {
                                                        const newTimes = [...(selectedJob.schedule_times || [])];
                                                        newTimes[idx] = e.target.value;
                                                        updateJob(selectedJob.id, { schedule_times: newTimes });
                                                    }}
                                                    className="flex-1 px-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const newTimes = selectedJob.schedule_times?.filter((_, i) => i !== idx) || [];
                                                        updateJob(selectedJob.id, { schedule_times: newTimes });
                                                    }}
                                                    className="px-3 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-lg"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => {
                                                const newTimes = [...(selectedJob.schedule_times || []), "00:00"];
                                                updateJob(selectedJob.id, { schedule_times: newTimes });
                                            }}
                                            className="w-full py-2 bg-gray-700/50 hover:bg-gray-700 border border-dashed border-gray-600 rounded-lg text-gray-400 text-sm"
                                        >
                                            + {t('เพิ่มเวลา', 'Add Time')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between p-4 bg-gray-700/30 rounded-lg">
                                <div>
                                    <div className="text-white font-medium">{t('เปิดใช้งาน', 'Enabled')}</div>
                                    <div className="text-sm text-gray-400">
                                        {t('เปิด/ปิด การทำงานอัตโนมัติ', 'Enable/disable automatic execution')}
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedJob.enabled}
                                        onChange={(e) => updateJob(selectedJob.id, { enabled: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>
                        </div>

                        {/* Last Result Section */}
                        {selectedJob.last_result && (
                            <div>
                                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                                    📊 {t('ผลลัพธ์ล่าสุด', 'Latest Result')}
                                    <span className="text-xs text-gray-500">
                                        ({formatDateTime(selectedJob.last_run)})
                                    </span>
                                </h4>

                                {selectedJob.job_type === 'api_status_check' && selectedJob.last_result.results && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-4 text-sm mb-3">
                                            <span className="text-emerald-400">
                                                🟢 Online: {selectedJob.last_result.online_count}
                                            </span>
                                            <span className="text-rose-400">
                                                🔴 Offline: {selectedJob.last_result.offline_count}
                                            </span>
                                            <span className="text-gray-400">
                                                Total: {selectedJob.last_result.total_checked}
                                            </span>
                                        </div>

                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {(selectedJob.last_result.results as ApiStatusResult[]).map((result, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`p-3 rounded-lg border ${result.status === 'online'
                                                        ? 'bg-emerald-500/10 border-emerald-500/30'
                                                        : 'bg-rose-500/10 border-rose-500/30'
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <span className="text-white font-medium">{result.market_name}</span>
                                                            <span className="text-xs text-gray-500 ml-2">({result.market_id})</span>
                                                        </div>
                                                        <span className={result.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}>
                                                            {result.status === 'online' ? '🟢 Online' : '🔴 Offline'}
                                                            {result.response_time_ms && (
                                                                <span className="text-xs text-gray-500 ml-2">
                                                                    {result.response_time_ms}ms
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-gray-500 font-mono mt-1 truncate">
                                                        {result.url}
                                                    </div>
                                                    {result.error_message && (
                                                        <div className="text-xs text-rose-400 mt-1">
                                                            {result.error_message}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Generic JSON display for other job types */}
                                {selectedJob.job_type !== 'api_status_check' && (
                                    <pre className="p-3 bg-gray-900 rounded-lg text-xs text-gray-300 overflow-x-auto">
                                        {JSON.stringify(selectedJob.last_result, null, 2)}
                                    </pre>
                                )}
                            </div>
                        )}

                        {/* Close Button */}
                        <div className="flex justify-end mt-6">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                            >
                                {t('ปิด', 'Close')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
