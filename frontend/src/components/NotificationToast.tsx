'use client';

import { useState, useEffect, createContext, useContext, useCallback } from 'react';

// Toast Types
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'alert';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
}

// Toast Context
interface ToastContextType {
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id'>) => string;
    removeToast: (id: string) => void;
    clearAllToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Toast Provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newToast: Toast = {
            ...toast,
            id,
            duration: toast.duration ?? 5000,
        };

        setToasts((prev) => [...prev, newToast]);
        return id;
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const clearAllToasts = useCallback(() => {
        setToasts([]);
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast, clearAllToasts }}>
            {children}
            <ToastContainer />
        </ToastContext.Provider>
    );
}

// Hook to use toast
export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

// Individual Toast Component
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        if (toast.duration && toast.duration > 0) {
            const timer = setTimeout(() => {
                setIsExiting(true);
                setTimeout(onRemove, 300); // Wait for exit animation
            }, toast.duration);

            return () => clearTimeout(timer);
        }
    }, [toast.duration, onRemove]);

    const handleClose = () => {
        setIsExiting(true);
        setTimeout(onRemove, 300);
    };

    // Colors and icons based on type
    const config = {
        success: {
            bg: 'bg-green-500',
            border: 'border-green-600',
            icon: '✓',
            iconBg: 'bg-green-600',
        },
        error: {
            bg: 'bg-red-500',
            border: 'border-red-600',
            icon: '✕',
            iconBg: 'bg-red-600',
        },
        warning: {
            bg: 'bg-yellow-500',
            border: 'border-yellow-600',
            icon: '⚠',
            iconBg: 'bg-yellow-600',
        },
        info: {
            bg: 'bg-blue-500',
            border: 'border-blue-600',
            icon: 'ℹ',
            iconBg: 'bg-blue-600',
        },
        alert: {
            bg: 'bg-purple-500',
            border: 'border-purple-600',
            icon: '🔔',
            iconBg: 'bg-purple-600',
        },
    };

    const { bg, border, icon, iconBg } = config[toast.type];

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-xl shadow-lg backdrop-blur-sm
                ${bg} bg-opacity-95 border ${border}
                text-white min-w-[300px] max-w-[400px]
                transform transition-all duration-300 ease-out
                ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
                hover:scale-[1.02] cursor-pointer
            `}
            onClick={handleClose}
        >
            {/* Icon */}
            <div className={`flex-shrink-0 w-8 h-8 rounded-full ${iconBg} flex items-center justify-center text-lg`}>
                {icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{toast.title}</p>
                {toast.message && (
                    <p className="text-sm text-white/80 mt-0.5 line-clamp-2">{toast.message}</p>
                )}
            </div>

            {/* Close Button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    handleClose();
                }}
                className="flex-shrink-0 p-1 hover:bg-white/20 rounded-full transition-colors"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}

// Toast Container
function ToastContainer() {
    const { toasts, removeToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
            {toasts.map((toast) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onRemove={() => removeToast(toast.id)}
                />
            ))}
        </div>
    );
}

// Helper functions for common toast types
export function showSuccessToast(addToast: ToastContextType['addToast'], title: string, message?: string) {
    return addToast({ type: 'success', title, message });
}

export function showErrorToast(addToast: ToastContextType['addToast'], title: string, message?: string) {
    return addToast({ type: 'error', title, message, duration: 8000 });
}

export function showWarningToast(addToast: ToastContextType['addToast'], title: string, message?: string) {
    return addToast({ type: 'warning', title, message });
}

export function showInfoToast(addToast: ToastContextType['addToast'], title: string, message?: string) {
    return addToast({ type: 'info', title, message });
}

export function showAlertToast(addToast: ToastContextType['addToast'], title: string, message?: string) {
    return addToast({ type: 'alert', title, message, duration: 10000 });
}

export default ToastProvider;
