import React, { useState, useMemo, useEffect } from 'react';
import {
    Calendar, Wallet, ArrowRight, FileText, Droplets, Zap, Loader2,
    ExternalLink, FileDown, MessageCircle, DollarSign, RefreshCcw,
    CheckCircle2, AlertCircle, Clock, Filter, CreditCard, Trash2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Tenant, Property, EnergyBill, WaterBill } from '../types';
import {
    createPayment, calculateDueDate, getCustomerByCpf,
    createCustomer, getPayments, formatReferenceMonth, getCustomers, deletePayment, getNextMonth, uploadPaymentDocument
} from '../services/asaasService';
import { db } from '../services/db';
import { Toast } from './Toast';

interface AsaasTabProps {
    tenants: Tenant[];
    properties: Property[];
    bills: EnergyBill[];
    waterBills: WaterBill[];
    filterMonth: string;
    setFilterMonth: (month: string) => void;
}

export const AsaasTab: React.FC<AsaasTabProps> = ({ tenants, properties, bills, waterBills, filterMonth, setFilterMonth }) => {
    const DISCOUNT_VALUE = 50;
    const [loadingCharge, setLoadingCharge] = useState<string | null>(null);
    const [isDashboardLoading, setIsDashboardLoading] = useState(false);
    const [asaasPayments, setAsaasPayments] = useState<any[]>([]);
    const [nextMonthPayments, setNextMonthPayments] = useState<any[]>([]); // Payments due next month
    const [activeView, setActiveView] = useState<'real' | 'prep'>('real');
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [customersMap, setCustomersMap] = useState<Record<string, string>>({});

    const [createdCharges, setCreatedCharges] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('asaas-created-charges');
        return saved ? JSON.parse(saved) : {};
    });
    const [toasts, setToasts] = useState<{ id: number, message: string, type: 'success' | 'error' | 'info' }[]>([]);

    const showToast = (message: string, type: 'success' | 'error' | 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => removeToast(id), 4000);
    };

    const removeToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    // --- Data Fetching (Real Asaas Payments) ---
    const fetchAsaasPayments = async () => {
        if (!filterMonth) return;
        setIsDashboardLoading(true);
        try {
            const nextMonth = getNextMonth(filterMonth);

            // Fetch payments (current + next month) and customers in parallel
            const [paymentsResult, nextPaymentsResult, customersResult] = await Promise.all([
                getPayments({ dueDate: filterMonth }),
                getPayments({ dueDate: nextMonth }),
                getCustomers({ limit: 100 })
            ]);

            setAsaasPayments(paymentsResult.data);
            setNextMonthPayments(nextPaymentsResult.data); // Store next month payments for checking existence

            // Logic to prune createdCharges that were deleted externally or didn't sync
            const allFetchedIds = new Set([
                ...paymentsResult.data.map((p: any) => p.id),
                ...nextPaymentsResult.data.map((p: any) => p.id)
            ]);

            const safeToPruneCurrent = paymentsResult.totalCount <= 100;
            const safeToPruneNext = nextPaymentsResult.totalCount <= 100;

            if (safeToPruneCurrent && safeToPruneNext) {
                setCreatedCharges(prev => {
                    const next = { ...prev };
                    let changed = false;
                    Object.entries(next).forEach(([key, paymentId]) => {
                        // Only prune keys that belong to the fetched months
                        if (key.endsWith(filterMonth) || key.endsWith(nextMonth)) {
                            if (!allFetchedIds.has(paymentId)) {
                                delete next[key];
                                changed = true;
                            }
                        }
                    });
                    if (changed) {
                        localStorage.setItem('asaas-created-charges', JSON.stringify(next));
                        return next;
                    }
                    return prev;
                });
            }

            // Update customers map
            const newMap: Record<string, string> = {};
            customersResult.data.forEach(c => {
                newMap[c.id] = c.name;
            });
            setCustomersMap(newMap);

            showToast("Sincronizado com Asaas", "success");
        } catch (e: any) {
            showToast("Erro ao buscar dados do Asaas.", "error");
        } finally {
            setIsDashboardLoading(false);
        }
    };

    useEffect(() => {
        fetchAsaasPayments();
        setSelectedStatus(null);
    }, [filterMonth]);

    // --- Stats Calculation ---
    const stats = useMemo(() => {
        const s: Record<string, { count: number, total: number, label: string, color: string, gradient: string, icon: React.ReactNode }> = {
            RECEIVED: { count: 0, total: 0, label: 'Recebidas', color: 'bg-emerald-500', gradient: 'from-emerald-400 to-teal-600', icon: <CheckCircle2 size={20} /> },
            CONFIRMED: { count: 0, total: 0, label: 'Confirmadas', color: 'bg-indigo-500', gradient: 'from-indigo-400 to-blue-700', icon: <CreditCard size={20} /> },
            PENDING: { count: 0, total: 0, label: 'Aguardando', color: 'bg-amber-500', gradient: 'from-amber-300 to-orange-500', icon: <Clock size={20} /> },
            OVERDUE: { count: 0, total: 0, label: 'Vencidas', color: 'bg-rose-500', gradient: 'from-rose-400 to-red-700', icon: <AlertCircle size={20} /> }
        };
        asaasPayments.forEach(p => {
            let status = p.status;
            if (status === 'RECEIVED_IN_CASH') status = 'RECEIVED';
            if (s[status]) {
                s[status].count++;
                s[status].total += p.value;
            }
        });
        return s;
    }, [asaasPayments]);

    // --- Helper Functions ---
    const getPreviousMonth = (monthStr: string) => {
        if (!monthStr || !monthStr.includes('-')) return null;
        try {
            const [year, month] = monthStr.split('-').map(Number);
            const date = new Date(year, month - 1 - 1, 1);
            return date.toISOString().slice(0, 7);
        } catch (e) { return null; }
    };

    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        const now = new Date();

        // Add current and next 4 months to handle future charges
        for (let i = 0; i < 5; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            months.add(d.toISOString().slice(0, 7));
        }

        bills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
        waterBills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
        return Array.from(months).sort().reverse();
    }, [bills, waterBills]);

    // --- Prep Table Logic (Same as before but clarified) ---
    const readingsMap = useMemo(() => {
        const map = new Map<string, Map<string, EnergyBill>>();
        bills.filter(b => b.currentReading !== undefined).forEach(b => {
            const propKey = b.propertyId || b.installationCode;
            if (!propKey) return;
            if (!map.has(propKey)) map.set(propKey, new Map());
            map.get(propKey)!.set(b.referenceMonth, b);
        });
        return map;
    }, [bills]);

    const waterReadingsMap = useMemo(() => {
        const map = new Map<string, Map<string, WaterBill>>();
        waterBills.filter(b => b.currentReading !== undefined).forEach(b => {
            const propKey = b.propertyId || b.installationCode;
            if (!propKey) return;
            if (!map.has(propKey)) map.set(propKey, new Map());
            map.get(propKey)!.set(b.referenceMonth, b);
        });
        return map;
    }, [waterBills]);

    const classifiedGroups = useMemo(() => {
        const groups = new Map<string, any>();
        bills.forEach(b => {
            const propId = b.propertyId || (b.installationCode ? `inst_${b.installationCode}` : 'unknown');
            const key = `${propId}_${b.referenceMonth}`;
            if (!groups.has(key)) {
                let property = b.propertyId ? properties.find(p => p.id === b.propertyId) : undefined;
                if (!property && b.installationCode) property = properties.find(p => p.mainMeterId === b.installationCode);
                groups.set(key, { key, month: b.referenceMonth, property, energy: {}, water: {} });
            }
            const g = groups.get(key);
            if (b.currentReading !== undefined || b.fileName.toLowerCase().includes('leitura')) g.energy.reading = b;
            else g.energy.invoice = b;
        });
        waterBills.forEach(b => {
            const propId = b.propertyId || (b.installationCode ? `inst_${b.installationCode}` : 'unknown');
            const key = `${propId}_${b.referenceMonth}`;
            if (!groups.has(key)) {
                let property = b.propertyId ? properties.find(p => p.id === b.propertyId) : undefined;
                if (!property && b.installationCode) property = properties.find(p => p.waterMeterId === b.installationCode);
                groups.set(key, { key, month: b.referenceMonth, property, energy: {}, water: {} });
            }
            const g = groups.get(key);
            if (b.currentReading !== undefined || b.fileName.toLowerCase().includes('leitura')) g.water.reading = b;
            else g.water.invoice = b;
        });
        return Array.from(groups.values()).map(g => {
            // Logic for calculating house values based on master consumption and sub-readings
            if (g.energy.reading || g.energy.invoice) {
                const prevM = getPreviousMonth(g.month);
                const propKey = g.property?.id || (g.energy.invoice?.installationCode || g.energy.reading?.installationCode);
                if (prevM && propKey && readingsMap.has(propKey)) {
                    g.energy.prevReading = readingsMap.get(propKey)!.get(prevM)?.currentReading;
                }
                const cur = g.energy.reading?.currentReading;
                const prev = g.energy.prevReading;
                const consumption = cur !== undefined && prev !== undefined ? (cur - prev) : (g.energy.invoice?.masterConsumption || 0);
                g.energy.consumption = consumption;
                // Simplified total logic for preparer
                const cost = g.energy.invoice?.kwhUnitCost || 0;
                g.energy.total = consumption * cost;
            }
            if (g.water.reading || g.water.invoice) {
                const prevM = getPreviousMonth(g.month);
                const propKey = g.property?.id || (g.water.invoice?.installationCode || g.water.reading?.installationCode);
                if (prevM && propKey && waterReadingsMap.has(propKey)) {
                    g.water.prevReading = waterReadingsMap.get(propKey)!.get(prevM)?.currentReading;
                }
                const cur = g.water.reading?.currentReading;
                const prev = g.water.prevReading;
                if (cur !== undefined && prev !== undefined) {
                    g.water.consumption = cur - prev;
                    g.water.total = g.water.consumption * (g.water.invoice?.m3UnitCost || 0);
                }
            }
            g.grandTotal = (g.energy.total || 0) + (g.water.total || 0);
            return g;
        }).sort((a, b) => {
            const mc = b.month.localeCompare(a.month);
            if (mc !== 0) return mc;
            return (a.property?.address || '').localeCompare(b.property?.address || '');
        });
    }, [bills, waterBills, properties, readingsMap, waterReadingsMap]);

    const filteredUnifiedGroups = useMemo(() => {
        if (!filterMonth) return [];
        return classifiedGroups.filter(g => g.month === filterMonth);
    }, [classifiedGroups, filterMonth]);

    const filteredAsaasPayments = useMemo(() => {
        if (!selectedStatus) return asaasPayments;
        return asaasPayments.filter(p => {
            if (selectedStatus === 'RECEIVED') return p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH';
            return p.status === selectedStatus;
        });
    }, [asaasPayments, selectedStatus]);

    // --- PDF Logic ---
    const handleDeletePayment = async (payment: any) => {
        if (!window.confirm(`Tem certeza que deseja excluir a cobrança ${payment.id}?`)) return;

        try {
            showToast('Excluindo cobrança...', 'info');
            await deletePayment(payment.id);
            showToast('Cobrança excluída com sucesso!', 'success');

            // 1. Remove from API lists
            setAsaasPayments(prev => prev.filter(p => p.id !== payment.id));
            setNextMonthPayments(prev => prev.filter(p => p.id !== payment.id));

            // 2. Remove from Local Cache (createdCharges)
            // We need to find the key that maps to this payment ID
            const newCreatedCharges = { ...createdCharges };
            const keyToDelete = Object.keys(newCreatedCharges).find(key => newCreatedCharges[key] === payment.id);

            if (keyToDelete) {
                delete newCreatedCharges[keyToDelete];
                setCreatedCharges(newCreatedCharges);
                localStorage.setItem('asaas-created-charges', JSON.stringify(newCreatedCharges));
            }

        } catch (error) {
            console.error(error);
            showToast('Erro ao excluir cobrança.', 'error');
        }
    };


    // --- Professional Receipt Helpers ---
    const numberToWordsPt = (num: number): string => {
        const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
        const tens = ['', 'dez', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
        const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
        const hundreds = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

        if (num === 0) return 'zero';
        if (num === 100) return 'cem';

        const parts: string[] = [];
        const h = Math.floor(num / 100);
        const t = Math.floor((num % 100) / 10);
        const u = num % 10;

        if (h > 0) {
            if (h === 1 && (t > 0 || u > 0)) parts.push('cento');
            else parts.push(hundreds[h]);
        }

        if (t === 1) {
            parts.push(teens[u]);
        } else {
            if (t > 0) parts.push(tens[t]);
            if (u > 0) parts.push(units[u]);
        }

        return parts.join(' e ');
    };

    const formatCurrencyPtExtenso = (value: number): string => {
        const integerPart = Math.floor(value);
        const decimalPart = Math.round((value - integerPart) * 100);

        let result = '';

        if (integerPart > 0) {
            if (integerPart >= 1000) {
                const thousands = Math.floor(integerPart / 1000);
                const rest = integerPart % 1000;
                result += (thousands === 1 ? 'mil' : numberToWordsPt(thousands) + ' mil');
                if (rest > 0) result += (rest < 100 ? ' e ' : ' ') + numberToWordsPt(rest);
            } else {
                result += numberToWordsPt(integerPart);
            }
            result += integerPart === 1 ? ' real' : ' reais';
        }

        if (decimalPart > 0) {
            if (result) result += ' e ';
            result += numberToWordsPt(decimalPart) + (decimalPart === 1 ? ' centavo' : ' centavos');
        }

        return result;
    };

    const createProfessionalReceiptPDF = async (group: any, description: string, total: number) => {
        const doc = new jsPDF({ orientation: 'landscape', format: 'a5' });
        const pageWidth = doc.internal.pageSize.getWidth(); // ~210mm
        const pageHeight = doc.internal.pageSize.getHeight(); // ~148mm
        const margin = 12;

        const primaryColor = [30, 41, 59];
        const accentColor = [59, 130, 246];
        const lightGray = [248, 250, 252];
        const darkGray = [71, 85, 105];

        // --- Compact Header ---
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, pageWidth, 35, 'F');

        // Decorative vertical bar (Fixed alignment)
        doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.rect(0, 0, 6, 35, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("RECIBO", margin + 8, 22);

        // Branding removed from here as per user request

        const tenant = tenants.find(t => t.id === group.property?.tenantId);
        const tenantName = tenant ? tenant.name : (group.property?.address || 'Inquilino');
        const valorExtenso = formatCurrencyPtExtenso(total);

        // --- Side-by-Side Data Row ---
        let y = 45;
        const colWidth = (pageWidth - (margin * 2) - 10) / 2;

        // Column 1: Pagador
        doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
        doc.roundedRect(margin, y, colWidth, 22, 2, 2, 'F');
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.text("PAGADOR", margin + 4, y + 6);
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setFontSize(11);
        const splitTenant = doc.splitTextToSize(tenantName.toUpperCase(), colWidth - 8);
        doc.text(splitTenant, margin + 4, y + 13);

        // Column 2: Total Highlight
        doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.roundedRect(margin + colWidth + 10, y, colWidth, 22, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text("TOTAL PAGO", margin + colWidth + 14, y + 6);
        doc.setFontSize(16);
        doc.text(`R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin + colWidth + 14, y + 15);

        y += 32;

        // --- Compressed Table Section ---
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.text("DETALHAMENTO", margin, y);
        y += 4;

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.1);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;

        doc.setFontSize(9);
        doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        doc.text("Item", margin + 4, y);
        doc.text("Referência", pageWidth / 2, y, { align: 'center' });
        doc.text("Valor", pageWidth - margin - 4, y, { align: 'right' });

        y += 3;
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;

        doc.setFont("helvetica", "normal");
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);

        const items = [];

        // Aluguel Month Calculation (Next Month)
        let rentRef = group.month;
        if (group.month && group.month.includes('-')) {
            const [y, m] = group.month.split('-').map(Number);
            const nextDate = new Date(y, m, 1);
            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            rentRef = `${monthNames[nextDate.getMonth()]} / ${nextDate.getFullYear()}`;
        }

        // Format Utilities Ref
        let utilsRef = group.month;
        if (group.month && group.month.includes('-')) {
            const [y, m] = group.month.split('-').map(Number);
            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            utilsRef = `${monthNames[m - 1]} / ${y}`;
        }

        if (group.property?.baseRent) {
            items.push({ name: 'Aluguel', ref: rentRef, val: group.property.baseRent });
        }

        const energyVal = group.energy?.total || 0;
        const waterVal = group.water?.total || 0;
        if (energyVal > 0 || waterVal > 0) {
            items.push({ name: 'Energia / Água', ref: utilsRef, val: energyVal + waterVal });
        }

        items.forEach(item => {
            doc.text(item.name, margin + 4, y);
            doc.text(item.ref, pageWidth / 2, y, { align: 'center' });
            doc.text(`R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, pageWidth - margin - 4, y, { align: 'right' });
            y += 6;
        });

        doc.line(margin, y, pageWidth - margin, y);
        y += 8;

        // --- Footer Area ---
        // Extenso
        doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        const splitExtenso = doc.splitTextToSize(`Valor por extenso: ${valorExtenso}.`, pageWidth - (margin * 2));
        doc.text(splitExtenso, margin, y);

        y = pageHeight - 18;

        const today = new Date();
        const dateStr = `${today.getDate()} de ${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][today.getMonth()]} de ${today.getFullYear()}`;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(`Salto, ${dateStr}`, margin, y);

        // --- Personalized Issuer Info ---
        doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setLineWidth(0.2);
        doc.line(pageWidth - margin - 70, y - 8, pageWidth - margin, y - 8);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Rogério Marcos Boitto", pageWidth - margin - 35, y - 4, { align: 'center' });
        doc.setFontSize(8);
        doc.text("160.024.608-70", pageWidth - margin - 35, y, { align: 'center' });

        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text("Pelo Emitente", pageWidth - margin - 35, y + 4, { align: 'center' });

        return { doc, tenantName };
    };

    const createUnifiedPDFDoc = async (group: any) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        let y = 20;

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(margin, 10, pageWidth - margin, 10);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(30, 41, 59);
        doc.text("Relatório Unificado de Utils", pageWidth / 2, y, { align: 'center' });
        y += 10;

        const tenant = tenants.find(t => t.id === group.property?.tenantId);
        const tenantName = tenant ? tenant.name : (group.property?.address || 'Unidade Desconhecida');

        const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        let formattedRef = group.month;
        if (group.month.includes('-')) {
            const [year, month] = group.month.split('-');
            formattedRef = `${monthNames[parseInt(month) - 1]} / ${year}`;
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.setTextColor(71, 85, 105);
        doc.text(tenantName, pageWidth / 2, y, { align: 'center' });
        y += 7;
        doc.text(`Referência: ${formattedRef}`, pageWidth / 2, y, { align: 'center' });
        y += 15;

        // Energy Section
        if (group.energy.total !== undefined) {
            doc.setFillColor(240, 249, 255);
            doc.rect(margin, y, pageWidth - (margin * 2), 8, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(14, 165, 233);
            doc.text("ENERGIA ELÉTRICA", margin + 5, y + 6);
            y += 12;

            doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(50);
            const eLines = [
                `Leitura Anterior: ${group.energy.prevReading ?? '-'}`,
                `Leitura Atual: ${group.energy.reading?.currentReading ?? '-'}`,
                `Consumo: ${group.energy.consumption ?? 0} kWh`,
                `Total Energia: R$ ${group.energy.total?.toFixed(2) ?? '0,00'}`
            ];
            eLines.forEach(line => { doc.text(line, margin, y + 5); y += 6; });
            y += 10;
        }

        // Water Section
        if (group.water.total !== undefined) {
            doc.setFillColor(236, 253, 245);
            doc.rect(margin, y, pageWidth - (margin * 2), 8, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(16, 185, 129);
            doc.text("ÁGUA & ESGOTO", margin + 5, y + 6);
            y += 12;

            doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(50);
            const wLines = [
                `Leitura Anterior: ${group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'} m³`,
                `Leitura Atual: ${group.water.reading?.currentReading?.toFixed(3).replace('.', ',') ?? '-'} m³`,
                `Consumo: ${group.water.consumption?.toFixed(3).replace('.', ',') ?? 0} m³`,
                `Total Água: R$ ${group.water.total?.toFixed(2) ?? '0,00'}`
            ];
            wLines.forEach(line => { doc.text(line, margin, y + 5); y += 6; });
            y += 10;
        }

        y += 5;
        doc.setDrawColor(203, 213, 225);
        doc.line(margin, y, pageWidth - margin, y);
        y += 10;

        const finalTotal = (group.energy.total || 0) + (group.water.total || 0);

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text(`TOTAL GERAL: R$ ${finalTotal.toFixed(2).replace('.', ',')}`, pageWidth - margin, y, { align: 'right' });

        return { doc, tenantName };
    };

    const generateUnifiedPDF = async (group: any) => {
        const { doc, tenantName } = await createUnifiedPDFDoc(group);
        doc.save(`${tenantName}.pdf`);
    };

    const handleSendWhatsapp = async (group: any) => {
        const tenant = tenants.find(t => t.id === group.property?.tenantId);
        if (!tenant || !tenant.phone) {
            showToast("Telefone do inquilino não encontrado.", "error");
            return;
        }
        const phone = tenant.phone.replace(/\D/g, '');
        const message = `Olá ${tenant.name}, segue o relatório unificado de contas do mês de ${group.month}.`;

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile && navigator.share && navigator.canShare) {
            try {
                const { doc, tenantName } = await createUnifiedPDFDoc(group);
                const pdfBlob = doc.output('blob');
                const file = new File([pdfBlob], `${tenantName}.pdf`, { type: 'application/pdf' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: 'Relatório Unificado', text: message });
                    return;
                }
            } catch (e) { console.error(e); }
        }

        showToast("Baixando relatório... Por favor, anexe-o manualmente no WhatsApp.", "info");
        await generateUnifiedPDF(group);
        setTimeout(() => {
            window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(message)}`, '_blank');
        }, 1000);
    };

    const handleCharge = async (group: any) => {
        const property = group.property;

        // Histórico de Inquilinos: Busca o inquilino ativo no mês de referência
        const refDate = new Date(group.month + '-10');
        const tenant = tenants.find(t => {
            if (t.propertyId !== property?.id) return false;
            const entry = t.entryDate ? new Date(t.entryDate) : null;
            const exit = t.exitDate ? new Date(t.exitDate) : null;
            if (entry && refDate < entry) return false;
            if (exit && refDate > exit) return false;
            return true;
        }) || (property?.tenantId ? tenants.find((t: any) => t.id === property.tenantId) : null);

        if (!tenant) {
            showToast('Inquilino não vinculado na data de referência.', 'error');
            return;
        }

        const chargeKey = `${tenant.id}-${group.month}`;
        const hasAsaasPayment = nextMonthPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${group.month}`)) ||
            asaasPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${group.month}`));

        if (hasAsaasPayment || createdCharges[chargeKey]) {
            showToast('Cobrança já existe! Exclua a antiga na aba "Consultar" para recriar.', 'error');
            return;
        }

        if (!tenant.cpf || !tenant.dueDay) {
            showToast('Falta CPF ou dia de vencimento!', 'error');
            return;
        }

        const waterValue = group.water.total || 0;
        const energyValue = group.energy.total || 0;
        const rent = property.baseRent || 0;
        const total = waterValue + energyValue + rent;

        if (total <= 0) {
            showToast('Nada a cobrar!', 'error');
            return;
        }

        setLoadingCharge(tenant.id);
        try {
            let customerId = tenant.asaasCustomerId;
            if (!customerId) {
                const cpfClean = tenant.cpf.replace(/\D/g, '');
                let existing = await getCustomerByCpf(cpfClean);
                if (existing) {
                    customerId = existing.id;
                } else {
                    try {
                        const newC = await createCustomer(tenant.name, cpfClean, tenant.email || `sem-email-${cpfClean}@boitto.app`, tenant.phone || '');
                        customerId = newC.id;
                    } catch (createErr: any) {
                        // Se falhar (ex: CPF já existe), tenta buscar de novo
                        const retry = await getCustomerByCpf(cpfClean);
                        if (retry) {
                            customerId = retry.id;
                        } else {
                            throw createErr;
                        }
                    }
                }
                await db.updateTenant(tenant.id, { asaasCustomerId: customerId });
            }

            const dueDate = calculateDueDate(tenant.dueDay, group.month);
            const dateObj = new Date(dueDate + 'T12:00:00');
            dateObj.setDate(dateObj.getDate() - 1);
            const limitDate = dateObj.toISOString().split('T')[0];

            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            const [yRef, mRef] = group.month.split('-').map(Number);
            const rentDate = new Date(yRef, mRef, 1);
            const rentRef = `${monthNames[rentDate.getMonth()]}/${rentDate.getFullYear()}`;
            const utilsRef = `${monthNames[mRef - 1]}/${yRef}`;

            const rentVal = property.baseRent || 0;
            const energyVal = group.energy?.total || 0;
            const waterVal = group.water?.total || 0;

            const description = `Aluguel + Contas\nUnidade: ${property.address}\n\n` +
                `Aluguel (${rentRef}): R$ ${rentVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `Energia (${utilsRef}): R$ ${energyVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `Água (${utilsRef}): R$ ${waterVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

            let payment;
            try {
                payment = await createPayment({
                    customerId,
                    dueDate,
                    value: total,
                    description,
                    items: [],
                    discount: { value: DISCOUNT_VALUE, limitDate, type: 'FIXED' }
                });
            } catch (payErr: any) {
                // FALLBACK: Se o customerId estava salvo mas é inválido no Asaas (ex: deleção manual no painel)
                if (payErr.message?.includes('invalid_customer')) {
                    console.warn("ID de cliente inválido detectado. Limpando e tentando recriar...");
                    const cpfClean = tenant.cpf.replace(/\D/g, '');
                    // Força nova busca/criação
                    const retryC = await getCustomerByCpf(cpfClean) ||
                        await createCustomer(tenant.name, cpfClean, tenant.email || `sem-email-${cpfClean}@boitto.app`, tenant.phone || '');
                    customerId = retryC.id;
                    await db.updateTenant(tenant.id, { asaasCustomerId: customerId });

                    // Segunda tentativa de pagamento
                    payment = await createPayment({
                        customerId,
                        dueDate,
                        value: total,
                        description,
                        items: [],
                        discount: { value: DISCOUNT_VALUE, limitDate, type: 'FIXED' }
                    });
                } else {
                    throw payErr;
                }
            }

            // --- Upload do Recibo (Profissional) ---
            try {
                showToast('Gerando recibo profissional e anexando...', 'info');
                const { doc, tenantName } = await createProfessionalReceiptPDF(group, description, total);
                const pdfBase64 = doc.output('datauristring'); // Gera a string data:application/pdf;base64,...

                await uploadPaymentDocument(
                    payment.id,
                    pdfBase64,
                    `Recibo_${tenantName}_${group.month}.pdf`,
                    true // availableAfterPayment
                );
                showToast('Recibo profissional anexado!', 'success');
            } catch (uploadError) {
                console.error('Erro ao anexar recibo:', uploadError);
                showToast('Cobrança criada, mas houve erro ao anexar o recibo.', 'error');
            }

            const newC = { ...createdCharges, [chargeKey]: payment.id };
            setCreatedCharges(newC);
            localStorage.setItem('asaas-created-charges', JSON.stringify(newC));
            showToast('Cobrança criada!', 'success');
            if (payment.invoiceUrl) window.open(payment.invoiceUrl, '_blank');
            fetchAsaasPayments(); // Sync with Asaas after creating a charge
        } catch (e: any) {
            showToast(e.message || 'Erro!', 'error');
        } finally {
            setLoadingCharge(null);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Multi-Toast Stack */}
            <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
                {toasts.map((t, index) => (
                    <div
                        key={t.id}
                        className="pointer-events-auto animate-fade-in transition-all duration-300 transform translate-y-0"
                        style={{
                            transitionDelay: `${index * 50}ms`,
                            zIndex: 200 + index
                        }}
                    >
                        <Toast
                            message={t.message}
                            type={t.type}
                            onClose={() => removeToast(t.id)}
                        />
                    </div>
                ))}
            </div>

            {/* Header section with Glassmorphism */}
            <section className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-[2.5rem] blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
                <div className="relative bg-white/60 backdrop-blur-3xl border border-white/40 p-3 rounded-2xl shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 text-white flex-shrink-0">
                            <Wallet size={20} />
                        </div>
                        <div>
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest mb-1">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </span>
                                Asaas
                            </div>
                            <h2 className="text-xl font-black text-slate-900 tracking-tight">
                                Situação das cobranças
                            </h2>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50">
                        <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select
                                className="bg-white border-none rounded-xl pl-11 pr-8 py-2 font-black text-slate-700 shadow-sm focus:ring-4 focus:ring-emerald-500/10 transition-all cursor-pointer min-w-[200px] text-sm appearance-none"
                                value={filterMonth}
                                onChange={(e) => setFilterMonth(e.target.value)}
                            >
                                <option value="">Mês...</option>
                                {availableMonths.map(m => (
                                    <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={fetchAsaasPayments}
                            disabled={isDashboardLoading}
                            className="p-2.5 bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 group/btn"
                        >
                            <RefreshCcw size={18} className={`${isDashboardLoading ? 'animate-spin' : 'group-hover/btn:rotate-180 transition-transform duration-700'}`} />
                        </button>
                    </div>
                </div>
            </section>

            {/* Dashboard Stats Cards avec Rich Aesthetics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {(Object.entries(stats) as [keyof typeof stats, any][]).map(([status, s]) => (
                    <button
                        key={status}
                        onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
                        className={`p-3 rounded-3xl transition-all text-left relative overflow-hidden group/card shadow-lg ${selectedStatus === status
                            ? 'ring-4 ring-emerald-500/20 translate-y-[-4px]'
                            : 'hover:translate-y-[-4px] active:translate-y-[-2px]'
                            } bg-white border border-slate-100/50`}
                    >
                        {/* Background Ornament */}
                        <div className={`absolute -right-4 -bottom-4 w-32 h-32 bg-gradient-to-br ${s.gradient} opacity-[0.03] rounded-full group-hover/card:scale-150 transition-transform duration-700`}></div>

                        <div className="flex items-center justify-between mb-3 relative">
                            <div className={`w-9 h-9 bg-gradient-to-br ${s.gradient} text-white rounded-xl flex items-center justify-center shadow-2xl transition-transform`}>
                                {React.cloneElement(s.icon as React.ReactElement, { size: 16 })}
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-lg font-black text-slate-900 tracking-tighter">{s.count}</span>
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.label}</span>
                            </div>
                        </div>

                        <div className="relative">
                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5 opacity-60">Total</div>
                            <p className="text-lg font-black text-slate-900 tracking-tight">
                                <span className="text-[10px] font-bold text-slate-400 mr-0.5">R$</span>
                                {s.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                        </div>

                        {selectedStatus === status && (
                            <div className="absolute top-6 right-6 text-emerald-500 animate-bounce">
                                <Filter size={18} />
                            </div>
                        )}

                        {/* Gloss Effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/20 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none"></div>
                    </button>
                ))}
            </div>

            {/* Main Content Area - Glassmorphism Container */}
            <div className="bg-white/70 backdrop-blur-2xl rounded-2xl border border-white/50 shadow-2xl overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-b from-slate-50/50 to-white/0 pointer-events-none"></div>

                {/* Premium Segmented Control Switcher */}
                <div className="relative p-2 max-w-lg mx-auto mt-4">
                    <div className="flex bg-slate-100/80 p-1 rounded-2xl border border-slate-200/50 relative">
                        {/* Animated Highlighting Indicator */}
                        <div
                            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-xl shadow-xl transition-all duration-500 ease-out border border-slate-100 ${activeView === 'real' ? 'left-1' : 'left-[50%]'
                                }`}
                        ></div>

                        <button
                            onClick={() => setActiveView('real')}
                            className={`flex-1 relative z-10 py-2 px-4 rounded-xl font-black text-[11px] transition-all flex items-center justify-center gap-2 ${activeView === 'real' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <div className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${activeView === 'real' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-200/50'
                                }`}>
                                <CreditCard size={12} />
                            </div>
                            Consultar Cobranças
                        </button>
                        <button
                            onClick={() => setActiveView('prep')}
                            className={`flex-1 relative z-10 py-2 px-4 rounded-xl font-black text-[11px] transition-all flex items-center justify-center gap-2 ${activeView === 'prep' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <div className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${activeView === 'prep' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-200/50'
                                }`}>
                                <Zap size={12} />
                            </div>
                            Preparar Faturamento
                        </button>
                    </div>
                </div>

                <div className="p-6 relative">
                    {activeView === 'real' ? (
                        <div className="space-y-8">
                            <div className="flex items-center justify-between pb-4 border-b border-slate-100/50">
                                <div>
                                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                                        {selectedStatus
                                            ? <span>Filtro: <span className="text-emerald-500">{stats[selectedStatus as keyof typeof stats].label}</span></span>
                                            : 'Todas as Cobranças'
                                        }
                                    </h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Registros sincronizados com Asaas</p>
                                </div>
                                <div className="px-4 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs font-bold border border-slate-200">
                                    {filteredAsaasPayments.length} registros
                                </div>
                            </div>

                            {/* Desktop View (Table) */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100/50">
                                            <th className="px-3 py-2">Inquilino</th>
                                            <th className="px-3 py-2">Valor & Status</th>
                                            <th className="px-3 py-2">Vencimento</th>
                                            <th className="px-3 py-2">Pagamento</th>
                                            <th className="px-3 py-2 text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100/30">
                                        {filteredAsaasPayments.length > 0 ? (
                                            filteredAsaasPayments.map(p => {
                                                const sInfo = (Object.values(stats) as any[]).find(s => s.label === (p.status === 'RECEIVED_IN_CASH' ? 'Recebidas' : (stats as any)[p.status]?.label)) || stats.PENDING;
                                                return (
                                                    <tr key={p.id} className="group hover:bg-white/50 transition-all duration-300">
                                                        <td className="px-3 py-2">
                                                            <div className="font-black text-slate-900 text-base tracking-tight leading-tight">
                                                                {tenants.find(t => t.asaasCustomerId === p.customer)?.name ||
                                                                    customersMap[p.customer] ||
                                                                    (p as any).customerName ||
                                                                    'Cliente'}
                                                            </div>
                                                            <div className="text-[9px] text-slate-400 font-mono mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity tracking-wider uppercase">ID: {p.id}</div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="font-black text-slate-900 text-base">R$ {p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                                            <div className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${sInfo.color} text-white shadow-lg shadow-current/20`}>
                                                                {React.cloneElement(sInfo.icon as React.ReactElement, { size: 10 })}
                                                                {sInfo.label}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-black border border-slate-200">
                                                                <Calendar size={12} className="text-slate-400" />
                                                                {p.dueDate.split('-').reverse().join('/')}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black border border-emerald-200/50">
                                                                <CreditCard size={12} className="text-emerald-400" />
                                                                {(p as any).paymentDate
                                                                    ? (p as any).paymentDate.split('-').reverse().join('/')
                                                                    : (p as any).confirmedDate
                                                                        ? (p as any).confirmedDate.split('-').reverse().join('/')
                                                                        : '--'}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <a
                                                                href={p.invoiceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-900 border border-slate-200 rounded-xl hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all font-black text-[10px] shadow-sm hover:shadow-lg hover:translate-y-[-1px] active:translate-y-0"
                                                            >
                                                                Fatura
                                                                <ExternalLink size={12} />
                                                            </a>
                                                            {p.status !== 'RECEIVED' && p.status !== 'RECEIVED_IN_CASH' && (
                                                                <button
                                                                    onClick={() => handleDeletePayment(p)}
                                                                    className="ml-2 inline-flex items-center justify-center w-8 h-8 bg-white text-red-500 border border-slate-200 rounded-xl hover:bg-red-500 hover:text-white hover:border-red-500 transition-all shadow-sm hover:shadow-lg hover:translate-y-[-1px] active:translate-y-0"
                                                                    title="Excluir Cobrança"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-20 text-center">
                                                    <div className="flex flex-col items-center gap-4">
                                                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
                                                            <Filter size={40} />
                                                        </div>
                                                        <p className="text-slate-400 font-black text-lg">Nenhuma cobrança para este filtro.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile View (Cards) */}
                            <div className="md:hidden space-y-4">
                                {filteredAsaasPayments.length > 0 ? (
                                    filteredAsaasPayments.map(p => {
                                        const sInfo = (Object.values(stats) as any[]).find(s => s.label === (p.status === 'RECEIVED_IN_CASH' ? 'Recebidas' : (stats as any)[p.status]?.label)) || stats.PENDING;
                                        const tenantName = tenants.find(t => t.asaasCustomerId === p.customer)?.name ||
                                            customersMap[p.customer] ||
                                            (p as any).customerName ||
                                            'Cliente';

                                        return (
                                            <div key={p.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-4">
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <div className="font-black text-slate-900 text-lg leading-tight">{tenantName}</div>
                                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-wider uppercase">ID: {p.id}</div>
                                                    </div>
                                                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${sInfo.color} text-white shadow-lg shadow-current/20`}>
                                                        {sInfo.label}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3 mb-4">
                                                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                                                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Valor</div>
                                                        <div className="font-black text-slate-900 text-sm">R$ {p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                                    </div>
                                                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                                                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Vencimento</div>
                                                        <div className="font-black text-slate-700 text-sm">
                                                            {p.dueDate.split('-').reverse().join('/')}
                                                        </div>
                                                    </div>
                                                </div>

                                                {(p as any).paymentDate || (p as any).confirmedDate ? (
                                                    <div className="mb-4 bg-emerald-50/50 p-2 rounded-xl border border-emerald-100 flex items-center gap-2">
                                                        <CreditCard size={14} className="text-emerald-500" />
                                                        <div>
                                                            <div className="text-[9px] font-bold text-emerald-600/60 uppercase tracking-widest">Pago em</div>
                                                            <div className="text-xs font-black text-emerald-700">
                                                                {((p as any).paymentDate || (p as any).confirmedDate).split('-').reverse().join('/')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <div className="flex gap-2">
                                                    <a
                                                        href={p.invoiceUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[11px] shadow-lg shadow-slate-900/20 active:scale-95 transition-all"
                                                    >
                                                        <ExternalLink size={14} />
                                                        Ver Fatura
                                                    </a>
                                                    {p.status !== 'RECEIVED' && p.status !== 'RECEIVED_IN_CASH' && (
                                                        <button
                                                            onClick={() => handleDeletePayment(p)}
                                                            className="w-11 h-11 flex items-center justify-center bg-red-50 text-red-500 border border-red-100 rounded-xl active:scale-95 transition-all"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
                                        <Filter size={32} className="mx-auto text-slate-200 mb-2" />
                                        <p className="text-slate-400 font-bold">Nenhuma cobrança encontrada.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* Preparation View */
                        <div className="space-y-8">
                            {/* Desktop View (Table) */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-50/50 border-b border-slate-100">
                                        <tr>
                                            <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">Inquilino / Unidade</th>
                                            <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase text-center">Consumos</th>
                                            <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase text-center">Aluguel</th>
                                            <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase text-center">TOTAL</th>
                                            <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {filteredUnifiedGroups.length > 0 ? (
                                            filteredUnifiedGroups.map((data, idx) => {
                                                const refDate = new Date(data.month + '-10');
                                                const tenant = tenants.find(t => {
                                                    if (t.propertyId !== data.property?.id) return false;
                                                    const entry = t.entryDate ? new Date(t.entryDate) : null;
                                                    const exit = t.exitDate ? new Date(t.exitDate) : null;
                                                    if (entry && refDate < entry) return false;
                                                    if (exit && refDate > exit) return false;
                                                    return true;
                                                }) || tenants.find(t => t.id === data.property?.tenantId);
                                                const chargeKey = tenant ? `${tenant.id}-${data.month}` : null;
                                                const hasAsaasPayment = tenant && (
                                                    nextMonthPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`)) ||
                                                    asaasPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`))
                                                );
                                                const isCharged = hasAsaasPayment || (chargeKey && createdCharges[chargeKey]);
                                                const isLoading = loadingCharge === tenant?.id;
                                                const grossTotal = (data.grandTotal || 0) + (data.property?.baseRent || 0);
                                                const netTotal = grossTotal - DISCOUNT_VALUE;
                                                return (
                                                    <tr key={idx} className="group hover:bg-white/50 transition-all duration-300">
                                                        <td className="px-3 py-2">
                                                            <div className="font-black text-slate-900 leading-tight text-base tracking-tight">{tenant?.name || 'Vazio'}</div>
                                                            <div className="text-[9px] text-slate-400 mt-1 uppercase font-black tracking-widest leading-none truncate max-w-[150px]">{data.property?.address}</div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 font-black text-[9px]">
                                                                    <Droplets size={10} />
                                                                    Água: R$ {data.water.total?.toFixed(2).replace('.', ',') || '0,00'}
                                                                </div>
                                                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 font-black text-[9px]">
                                                                    <Zap size={10} />
                                                                    Energia: R$ {data.energy.total?.toFixed(2).replace('.', ',') || '0,00'}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-center font-black text-slate-700 text-sm whitespace-nowrap">R$ {data.property?.baseRent?.toFixed(2).replace('.', ',') || '0,00'}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5 opacity-60">TOTAL</div>
                                                            <span className="font-black text-slate-900 text-lg tracking-tighter whitespace-nowrap">R$ {grossTotal.toFixed(2).replace('.', ',')}</span>
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <div className="flex flex-row items-center justify-center gap-2 transition-all duration-300">
                                                                <button
                                                                    onClick={() => handleCharge(data)}
                                                                    disabled={!tenant || isLoading || !!isCharged}
                                                                    className={`h-9 px-4 rounded-xl transition-all font-black text-[10px] shadow-lg flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${isCharged
                                                                        ? 'bg-blue-500 text-white shadow-blue-500/30 ring-2 ring-blue-500/50'
                                                                        : 'bg-slate-900 text-white shadow-slate-900/40 hover:scale-105 active:scale-95'
                                                                        }`}
                                                                >
                                                                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : isCharged ? <CheckCircle2 size={14} /> : <DollarSign size={14} />}
                                                                    {isCharged ? 'Criada' : 'Gerar Cobrança'}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-20 text-center">
                                                    <div className="flex flex-col items-center gap-4">
                                                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
                                                            <Zap size={40} />
                                                        </div>
                                                        <p className="text-slate-400 font-black text-lg">Sem registros de faturamento para este mês.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile View (Cards) */}
                            <div className="md:hidden space-y-4">
                                {filteredUnifiedGroups.length > 0 ? (
                                    filteredUnifiedGroups.map((data, idx) => {
                                        const refDate = new Date(data.month + '-10');
                                        const tenant = tenants.find(t => {
                                            if (t.propertyId !== data.property?.id) return false;
                                            const entry = t.entryDate ? new Date(t.entryDate) : null;
                                            const exit = t.exitDate ? new Date(t.exitDate) : null;
                                            if (entry && refDate < entry) return false;
                                            if (exit && refDate > exit) return false;
                                            return true;
                                        }) || tenants.find(t => t.id === data.property?.tenantId);
                                        const chargeKey = tenant ? `${tenant.id}-${data.month}` : null;
                                        const hasAsaasPayment = tenant && (
                                            nextMonthPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`)) ||
                                            asaasPayments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`))
                                        );
                                        const isCharged = hasAsaasPayment || (chargeKey && createdCharges[chargeKey]);
                                        const isLoading = loadingCharge === tenant?.id;
                                        const grossTotal = (data.grandTotal || 0) + (data.property?.baseRent || 0);
                                        const netTotal = grossTotal - DISCOUNT_VALUE;

                                        return (
                                            <div key={idx} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-4">
                                                <div className="mb-4">
                                                    <div className="font-black text-slate-900 text-lg leading-tight">{tenant?.name || 'Vazio'}</div>
                                                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{data.property?.address}</div>
                                                </div>

                                                <div className="space-y-2 mb-4">
                                                    <div className="flex justify-between items-center text-xs">
                                                        <div className="text-slate-500 font-bold">Consumos</div>
                                                        <div className="flex gap-1">
                                                            <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 font-black">💧 R$ {data.water.total?.toFixed(2).replace('.', ',') || '0,00'}</span>
                                                            <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-600 font-black">⚡ R$ {data.energy.total?.toFixed(2).replace('.', ',') || '0,00'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between items-center text-xs">
                                                        <div className="text-slate-500 font-bold">Aluguel</div>
                                                        <div className="font-black text-slate-700">R$ {data.property?.baseRent?.toFixed(2).replace('.', ',') || '0,00'}</div>
                                                    </div>
                                                    <div className="pt-2 border-t border-slate-50 flex justify-between items-center">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TOTAL</div>
                                                        <div className="text-lg font-black text-slate-900 tracking-tighter">
                                                            <span className="text-xs text-slate-400 font-bold mr-0.5">R$</span>
                                                            {grossTotal.toFixed(2).replace('.', ',')}
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => handleCharge(data)}
                                                    disabled={!tenant || isLoading || !!isCharged}
                                                    className={`w-full py-3.5 rounded-2xl transition-all font-black text-[11px] shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isCharged
                                                        ? 'bg-blue-500 text-white shadow-blue-500/30'
                                                        : 'bg-slate-900 text-white shadow-slate-900/40 active:scale-95'
                                                        }`}
                                                >
                                                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : isCharged ? <CheckCircle2 size={16} /> : <DollarSign size={16} />}
                                                    {isCharged ? 'Criada' : 'Gerar Cobrança'}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center py-12 bg-white rounded-2xl border border-slate-100">
                                        <Zap size={32} className="mx-auto text-slate-200 mb-2" />
                                        <p className="text-slate-400 font-bold">Sem faturamentos pendentes.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

