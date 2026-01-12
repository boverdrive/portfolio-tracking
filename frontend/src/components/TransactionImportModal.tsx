import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { AssetType, CreateTransactionRequest, Market, TradeAction } from '@/types';
import { createTransactionsBulk } from '@/lib/api';

interface TransactionImportModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

interface ParsedRow {
    Date: string;
    Action: string;
    Symbol: string;
    Market?: string;
    Quantity: string;
    Price: string;
    Fees?: string;
    Currency?: string;
    Leverage?: string;
    "Initial Margin"?: string;
    "InitialMargin"?: string;
    initial_margin?: string;
}

interface ValidationResult {
    row: number;
    data: CreateTransactionRequest;
    original: ParsedRow;
    errors: string[];
    isValid: boolean;
}

export default function TransactionImportModal({ onClose, onSuccess }: TransactionImportModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<ValidationResult[]>([]);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [addImportNote, setAddImportNote] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [importErrors, setImportErrors] = useState<string[]>([]);

    // Toggle specific row selection
    const toggleRow = (rowId: number) => {
        const newSelected = new Set(selectedRows);
        if (newSelected.has(rowId)) {
            newSelected.delete(rowId);
        } else {
            newSelected.add(rowId);
        }
        setSelectedRows(newSelected);
    };

    // Toggle all rows
    const toggleAll = () => {
        if (selectedRows.size === previewData.length) {
            setSelectedRows(new Set());
        } else {
            setSelectedRows(new Set(previewData.map(r => r.row)));
        }
    };

    // CSV Template for user download
    const handleDownloadTemplate = () => {
        const csvContent = "Date,Action,Symbol,Market,Quantity,Price,Fees,Currency,Leverage,Initial Margin\n2025-01-01,buy,BTC,binance,0.5,50000,10,USD,10,2500";
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'transaction_template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseFile(selectedFile);
        }
    };

    const parseFile = (file: File) => {
        setIsProcessing(true);
        Papa.parse<ParsedRow>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const validated = results.data.map((row, index) => validateRow(row, index + 1));
                setPreviewData(validated);
                // Select all valid rows by default
                setSelectedRows(new Set(validated.filter(r => r.isValid).map(r => r.row)));
                setIsProcessing(false);
            },
            error: (error) => {
                console.error(error);
                setImportErrors(["Failed to parse CSV file"]);
                setIsProcessing(false);
            }
        });
    };

    const validateRow = (row: ParsedRow, rowIndex: number): ValidationResult => {
        const errors: string[] = [];
        let isValid = true;

        // Required fields
        if (!row.Date) errors.push("Missing Date");
        if (!row.Action) errors.push("Missing Action");
        if (!row.Symbol) errors.push("Missing Symbol");
        if (!row.Quantity) errors.push("Missing Quantity");
        if (!row.Price) errors.push("Missing Price");

        const quantity = parseFloat(row.Quantity);
        const price = parseFloat(row.Price);
        const fees = row.Fees ? parseFloat(row.Fees) : 0;
        const leverage = row.Leverage ? parseFloat(row.Leverage) : undefined;

        // Parse Initial Margin (support multiple header formats)
        const rawMargin = row["Initial Margin"] || row["InitialMargin"] || row["initial_margin"];
        const initialMargin = rawMargin ? parseFloat(rawMargin) : undefined;

        const market = row.Market ? row.Market.toLowerCase() as Market : undefined;
        let action = row.Action.toLowerCase();

        // Normalize Action
        if (action === 'b' || action === 'buy') action = 'buy';
        else if (action === 's' || action === 'sell') action = 'sell';

        // Validate Types
        if (isNaN(quantity) || quantity <= 0) errors.push("Invalid Quantity");
        if (isNaN(price) || price <= 0) errors.push("Invalid Price");
        if (isNaN(fees) || fees < 0) errors.push("Invalid Fees");

        // Determine Asset Type (Heuristic)
        let assetType: AssetType = 'stock'; // Default
        const m = market || '';
        const s = row.Symbol.trim().toUpperCase();

        if (['binance', 'bitkub', 'okx'].includes(m) || ['BTC', 'ETH'].includes(s)) assetType = 'crypto';
        else if (['tfex'].includes(m)) assetType = 'tfex';
        else if (['nyse', 'nasdaq'].includes(m)) assetType = 'foreign_stock';

        if (errors.length > 0) isValid = false;

        const data: CreateTransactionRequest = {
            timestamp: row.Date ? new Date(row.Date).toISOString() : new Date().toISOString(),
            action: action as TradeAction,
            symbol: row.Symbol.trim().toUpperCase(),
            asset_type: assetType,
            market: market,
            quantity: quantity,
            price: price,
            fees: fees,
            currency: row.Currency,
            leverage: leverage,
            initial_margin: initialMargin,
            notes: "Imported via CSV"
        };

        return { row: rowIndex, data, original: row, errors, isValid };
    };

    const handleImport = async () => {
        const rowsToImport = previewData.filter(r => r.isValid && selectedRows.has(r.row));
        if (rowsToImport.length === 0) return;

        setIsUploading(true);
        try {
            const payload = rowsToImport.map(r => ({
                ...r.data,
                notes: addImportNote ? "Imported via CSV" : undefined
            }));
            const result = await createTransactionsBulk(payload);

            if (result.success) {
                alert(`Successfully imported ${result.count} transactions!`);
                onSuccess();
                onClose();
            } else {
                setImportErrors(result.errors || ["Unknown error during import"]);
            }
        } catch (error: any) {
            setImportErrors([error.message || "Network error"]);
        } finally {
            setIsUploading(false);
        }
    };

    const validCount = previewData.filter(r => r.isValid).length;
    const invalidCount = previewData.filter(r => !r.isValid).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-white">Import Transactions (CSV)</h2>
                        <p className="text-sm text-gray-400 mt-1">Bulk upload your trading history</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Error Display */}
                    {importErrors.length > 0 && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg text-sm">
                            <p className="font-bold mb-2">Import Errors:</p>
                            <ul className="list-disc list-inside space-y-1">
                                {importErrors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
                                {importErrors.length > 5 && <li>...and {importErrors.length - 5} more</li>}
                            </ul>
                        </div>
                    )}

                    {/* File Upload / Template */}
                    {!file ? (
                        <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-emerald-500/50 transition-colors bg-gray-800/50">
                            <div className="mb-4 text-emerald-500">
                                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-medium text-white mb-2">Upload CSV File</h3>
                            <p className="text-gray-400 text-sm mb-6">Drag and drop or click to browse</p>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileUpload}
                                className="hidden"
                                id="csv-upload"
                            />
                            <div className="flex justify-center gap-4">
                                <label
                                    htmlFor="csv-upload"
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer transition-colors"
                                >
                                    Select File
                                </label>
                                <button
                                    onClick={handleDownloadTemplate}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors border border-gray-600"
                                >
                                    Download Template
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-white font-medium">{file.name}</p>
                                    <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                            </div>
                            <button onClick={() => { setFile(null); setPreviewData([]); }} className="text-gray-400 hover:text-red-400">
                                Remove
                            </button>
                        </div>
                    )}

                    {/* Preview Table */}
                    {previewData.length > 0 && (
                        <div>
                            <div className="flex justify-between items-end mb-4">
                                <h3 className="text-white font-semibold">Preview</h3>
                                <div className="flex items-center gap-4 text-sm">
                                    <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white select-none">
                                        <input
                                            type="checkbox"
                                            checked={addImportNote}
                                            onChange={(e) => setAddImportNote(e.target.checked)}
                                            className="rounded border-gray-600 bg-gray-700 text-emerald-500 focus:ring-emerald-500/50"
                                        />
                                        Add "Imported via CSV" note
                                    </label>
                                    <span className="w-px h-4 bg-gray-700"></span>
                                    <span className="text-emerald-400">{validCount} Valid</span>
                                    <span className="text-red-400">{invalidCount} Invalid</span>
                                </div>
                            </div>
                            <div className="border border-gray-800 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-800 text-gray-400 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3 w-10">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRows.size === previewData.length && previewData.length > 0}
                                                    onChange={toggleAll}
                                                    className="rounded border-gray-600 bg-gray-700 text-emerald-500 focus:ring-emerald-500/50"
                                                />
                                            </th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Row</th>
                                            <th className="px-4 py-3">Date</th>
                                            <th className="px-4 py-3">Action</th>
                                            <th className="px-4 py-3">Symbol</th>
                                            <th className="px-4 py-3 text-right">Qty</th>
                                            <th className="px-4 py-3 text-right">Price</th>
                                            <th className="px-4 py-3">Issues</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800 bg-gray-900">
                                        {previewData.map((item, i) => (
                                            <tr key={i} className={!item.isValid ? 'bg-red-500/5' : ''}>
                                                <td className="px-4 py-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedRows.has(item.row)}
                                                        onChange={() => toggleRow(item.row)}
                                                        disabled={!item.isValid}
                                                        className="rounded border-gray-600 bg-gray-700 text-emerald-500 focus:ring-emerald-500/50 disabled:opacity-50"
                                                    />
                                                </td>
                                                <td className="px-4 py-2">
                                                    {item.isValid ? (
                                                        <span className="text-emerald-500">✓</span>
                                                    ) : (
                                                        <span className="text-red-500">✗</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-gray-400">#{item.row}</td>
                                                <td className="px-4 py-2 text-gray-300">{item.original.Date}</td>
                                                <td className="px-4 py-2">
                                                    <span className={`px-2 py-0.5 rounded text-xs ${item.data.action === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                                        {item.original.Action}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-white font-medium">{item.original.Symbol}</td>
                                                <td className="px-4 py-2 text-right text-gray-300">{item.original.Quantity}</td>
                                                <td className="px-4 py-2 text-right text-gray-300">{item.original.Price}</td>
                                                <td className="px-4 py-2 text-red-400 text-xs">
                                                    {item.errors.join(', ')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-800 flex justify-end gap-3 bg-gray-900/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                        disabled={isUploading}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={selectedRows.size === 0 || isUploading}
                        className={`px-6 py-2 rounded-lg font-medium transition-all ${selectedRows.size > 0 && !isUploading
                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/25'
                            : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                            }`}
                    >
                        {isUploading ? 'Importing...' : `Import ${selectedRows.size} Selected`}
                    </button>
                </div>
            </div>
        </div>
    );
}
