'use client';

import { useState, useEffect } from 'react';

interface StatusResponse {
    status: string;
    pocketbase: {
        url: string;
        connected: boolean;
    };
    timestamp: string;
}

export default function Footer() {
    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const response = await fetch(`${API_URL}/api/status`);
                if (response.ok) {
                    const data = await response.json();
                    setStatus(data);
                } else {
                    setStatus(null);
                }
            } catch {
                setStatus(null);
            } finally {
                setLoading(false);
            }
        };

        // Check immediately
        checkStatus();

        // Check every 30 seconds
        const interval = setInterval(checkStatus, 30000);

        return () => clearInterval(interval);
    }, [API_URL]);

    const isOnline = status?.pocketbase?.connected ?? false;

    return (
        <footer className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 py-2 px-4 z-40">
            <div className="w-full max-w-[1920px] mx-auto flex items-center justify-between text-xs">
                <div className="text-gray-500">
                    PT - Portfolio Tracking v1.0
                </div>

                <div className="flex items-center gap-4">
                    {/* Backend Status */}
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Backend:</span>
                        {loading ? (
                            <span className="text-gray-400">Checking...</span>
                        ) : status ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                Online
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-red-400">
                                <span className="w-2 h-2 rounded-full bg-red-400"></span>
                                Offline
                            </span>
                        )}
                    </div>

                    {/* PocketBase Status */}
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">PocketBase:</span>
                        {loading ? (
                            <span className="text-gray-400">Checking...</span>
                        ) : isOnline ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                Connected
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-yellow-400">
                                <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                                Offline Mode
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </footer>
    );
}
