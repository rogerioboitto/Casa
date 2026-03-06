import React, { useState, useEffect, useMemo } from 'react';
import {
    Wallet, CreditCard, ArrowUpRight, ArrowDownLeft,
    Search, Filter, Calendar, Bell, Info, ChevronRight,
    DollarSign, CheckCircle2, Clock, AlertCircle, RefreshCcw,
    Zap, Droplets, Home, ExternalLink, MoreVertical,
    ArrowRight, Eye, EyeOff, User
} from 'lucide-react';
import { Tenant, Property } from '../types';
import {
    getFinanceBalance,
    getFinancialTransactions,
    getPixAddressKeys,
    getPayments,
    getPaymentHistory,
    getPaymentNotifications,
    transferPix,
    getBankAccounts
} from '../services/asaasService';
import { Toast } from './Toast';

interface Asaas2TabProps {
    tenants: Tenant[];
    properties: Property[];
}

export const Asaas2Tab: React.FC<Asaas2TabProps> = ({ tenants, properties }) => {
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [pixKeys, setPixKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPayment, setSelectedPayment] = useState<any | null>(null);
    const [paymentDetails, setPaymentDetails] = useState<{ history: any[], notifications: any[] } | null>(null);
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [filterMonth, setFilterMonth] = useState<string>('ALL');
    const [showPixModal, setShowPixModal] = useState(false);
    const [pixStep, setPixStep] = useState<'SELECT' | 'AMOUNT' | 'CONFIRM'>('SELECT');
    const [selectedPixKey, setSelectedPixKey] = useState<any | null>(null);
    const [transferAmount, setTransferAmount] = useState<string>('');
    const [isTransferring, setIsTransferring] = useState(false);
    const [showBalance, setShowBalance] = useState(true);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' | 'info') => {
        setToast({ message, type });
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const [balanceRes, transRes, paymentsRes] = await Promise.all([
                getFinanceBalance(),
                getFinancialTransactions({ limit: 10 }),
                getPayments({ limit: 50 })
            ]);

            setBalance(balanceRes.balance);
            setTransactions(transRes.data);
            setPayments(paymentsRes.data);
        } catch (error) {
            console.error('Error fetching Asaas 2 data:', error);
            showToast('Erro ao carregar dados do Asaas', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleFetchPixKeys = async () => {
        try {
            // Buscamos tanto as chaves Pix quanto as contas bancárias externas cadastradas
            const [pixRes, bankRes] = await Promise.all([
                getPixAddressKeys(),
                getBankAccounts()
            ]);

            console.log('DEBUG: pixAddressKeys:', pixRes.data);
            console.log('DEBUG: bankAccounts:', bankRes.data);

            // 1. Mapear chaves Pix da própria conta Asaas (se houver)
            const pixItems = pixRes.data.map((k: any) => ({
                id: k.id,
                key: k.key || k.addressKey || k.pixAddressKey || '?',
                type: k.type || k.keyType || k.pixAddressKeyType || 'PIX',
                bankName: k.bankName || k.bank?.name || 'Asaas',
                ownerName: k.ownerName || k.name || 'Rogerio Marcos Boitto'
            }));

            // 2. Mapear contas bancárias externas registradas (Itaú, Mercado Pago, etc)
            const bankItems = bankRes.data.map((b: any) => ({
                id: b.id,
                key: b.pixAddressKey || `${b.agency}/${b.account}`,
                type: b.pixAddressKey ? 'PIX' : 'BANK_ACCOUNT',
                bankName: b.bank?.name || 'Banco',
                ownerName: b.ownerName || 'Rogerio Marcos Boitto',
                bankAccountId: b.id // Importante para a transferência
            }));

            const allItems = [...pixItems, ...bankItems];

            // 3. Filtro rigoroso: apenas contas do Rogerio Marcos Boitto
            const filtered = allItems.filter(item => {
                const owner = (item.ownerName || '').toUpperCase();
                return owner.includes('ROGERIO') && owner.includes('BOITTO');
            });

            // Remover duplicados por chave (caso uma conta bancária também esteja no pixAddressKeys)
            const unique = filtered.filter((v, i, a) => a.findIndex(t => t.key === v.key) === i);

            setPixKeys(unique);
            setPixStep('SELECT');
            setSelectedPixKey(null);
            setTransferAmount('');
            setShowPixModal(true);
        } catch (error) {
            console.error('DEBUG: Error in handleFetchPixKeys:', error);
            showToast('Erro ao carregar contas de destino', 'error');
        }
    };

    const handleViewPaymentDetails = async (payment: any) => {
        setSelectedPayment(payment);
        setIsDetailsLoading(true);
        try {
            const [history, notifications] = await Promise.all([
                getPaymentHistory(payment.id),
                getPaymentNotifications(payment.id)
            ]);
            setPaymentDetails({ history: history.data, notifications: notifications.data });
        } catch (error) {
            showToast('Erro ao carregar detalhes da cobrança', 'error');
        } finally {
            setIsDetailsLoading(false);
        }
    };

    const getBankBrand = (name: string = '') => {
        const n = name.toUpperCase();
        if (n.includes('ASAAS')) return { color: 'bg-[#00D68F]', text: 'text-[#00D68F]', domain: 'asaas.com', initials: 'AS' };
        if (n.includes('ITAU') || n.includes('ITAÚ')) return { color: 'bg-[#EC7000]', text: 'text-[#EC7000]', domain: 'itau.com.br', initials: 'IT' };
        if (n.includes('MERCADO PAGO')) return { color: 'bg-[#009EE3]', text: 'text-[#009EE3]', domain: 'mercadopago.com.br', initials: 'MP' };
        if (n.includes('NUBANK')) return { color: 'bg-[#8A05BE]', text: 'text-[#8A05BE]', domain: 'nubank.com.br', initials: 'NU' };
        if (n.includes('BRADESCO')) return { color: 'bg-[#CC092F]', text: 'text-[#CC092F]', domain: 'bradesco.com.br', initials: 'BR' };
        if (n.includes('SANTANDER')) return { color: 'bg-[#EC0000]', text: 'text-[#EC0000]', domain: 'santander.com.br', initials: 'SA' };
        if (n.includes('BANCO DO BRASIL') || n.includes('BB')) return { color: 'bg-[#F8D117]', text: 'text-[#F8D117]', domain: 'bb.com.br', initials: 'BB' };
        if (n.includes('CAIXA')) return { color: 'bg-[#00509F]', text: 'text-[#00509F]', domain: 'caixa.gov.br', initials: 'CE' };
        if (n.includes('INTER')) return { color: 'bg-[#FF7A00]', text: 'text-[#FF7A00]', domain: 'bancointer.com.br', initials: 'IN' };
        return { color: 'bg-slate-700', text: 'text-slate-400', domain: '', initials: name.substring(0, 2).toUpperCase() || 'BK' };
    };

    const [searchTerm, setSearchTerm] = useState('');

    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        payments.forEach(p => {
            if (p.dueDate) {
                months.add(p.dueDate.substring(0, 7)); // YYYY-MM
            }
        });
        return Array.from(months).sort().reverse();
    }, [payments]);

    const filteredPayments = useMemo(() => {
        let filtered = payments;
        if (filterStatus !== 'ALL') {
            filtered = filtered.filter(p => p.status === filterStatus);
        }
        if (filterMonth !== 'ALL') {
            filtered = filtered.filter(p => p.dueDate && p.dueDate.startsWith(filterMonth));
        }
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(p =>
                (p.customerName || '').toLowerCase().includes(term) ||
                (p.description || '').toLowerCase().includes(term)
            );
        }
        return filtered;
    }, [payments, filterStatus, filterMonth, searchTerm]);

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'RECEIVED':
            case 'RECEIVED_IN_CASH':
                return { bg: 'bg-emerald-500/10', text: 'text-emerald-500', icon: <CheckCircle2 size={12} /> };
            case 'PENDING':
                return { bg: 'bg-amber-500/10', text: 'text-amber-500', icon: <Clock size={12} /> };
            case 'OVERDUE':
                return { bg: 'bg-rose-500/10', text: 'text-rose-500', icon: <AlertCircle size={12} /> };
            case 'CONFIRMED':
                return { bg: 'bg-blue-500/10', text: 'text-blue-500', icon: <CreditCard size={12} /> };
            default:
                return { bg: 'bg-slate-500/10', text: 'text-slate-500', icon: <Info size={12} /> };
        }
    };

    const formatCurrency = (val: number) => {
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500"></div>
                <p className="text-slate-400 text-sm font-medium animate-pulse">Acessando sua conta...</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in bg-slate-50 min-h-screen -mx-4 -mt-6 px-6 pt-4 pb-12">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Top Bar - Dashboard Style */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <div>
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-tight mb-0.5">Saldo em conta</p>
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-black text-slate-800">
                                {showBalance ? (balance !== null ? formatCurrency(balance) : 'R$ ---') : '••••••••'}
                            </h2>
                            <button
                                onClick={() => setShowBalance(!showBalance)}
                                className="text-slate-400 hover:text-blue-600 p-1"
                            >
                                {showBalance ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                            <button
                                onClick={handleFetchPixKeys}
                                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95 ml-2"
                            >
                                <div className="italic text-[10px]">pix</div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Top Month Filter - Aligned Right */}
                <div className="flex items-center gap-2 bg-white/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/50 shadow-sm">
                    <div className="relative flex items-center gap-2">
                        <select
                            value={filterMonth}
                            onChange={(e) => setFilterMonth(e.target.value)}
                            className="bg-transparent text-[11px] font-black uppercase appearance-none focus:outline-none cursor-pointer text-slate-700 pr-5"
                        >
                            <option value="ALL">TODOS OS MESES</option>
                            {availableMonths.map(m => (
                                <option key={m} value={m}>
                                    {new Date(m + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).toUpperCase()}
                                </option>
                            ))}
                        </select>
                        <Calendar className="absolute right-0 text-slate-400 pointer-events-none" size={12} />
                    </div>
                    {filterMonth !== 'ALL' && (
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                    )}
                </div>
            </div>

            <div className="max-w-7xl mx-auto space-y-6">

                {/* Situation Section */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-black text-slate-800 tracking-tight">Situação das cobranças</h3>
                        <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
                            <span className="text-[8px] font-bold text-slate-500 uppercase">Resumo</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        {[
                            {
                                statusKey: 'RECEIVED',
                                label: 'Recebidas',
                                value: payments.filter(p => (p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH') && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).reduce((acc, curr) => acc + curr.value, 0),
                                color: 'emerald',
                                clients: new Set(payments.filter(p => (p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH') && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).map(p => p.customer)).size,
                                charges: payments.filter(p => (p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH') && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).length,
                                type: 'solid'
                            },
                            {
                                statusKey: 'CONFIRMED',
                                label: 'Confirmadas',
                                value: payments.filter(p => p.status === 'CONFIRMED' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).reduce((acc, curr) => acc + curr.value, 0),
                                color: 'blue',
                                clients: new Set(payments.filter(p => p.status === 'CONFIRMED' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).map(p => p.customer)).size,
                                charges: payments.filter(p => p.status === 'CONFIRMED' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).length,
                                type: 'striped'
                            },
                            {
                                statusKey: 'PENDING',
                                label: 'Aguardando pagamento',
                                value: payments.filter(p => p.status === 'PENDING' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).reduce((acc, curr) => acc + curr.value, 0),
                                color: 'orange',
                                clients: new Set(payments.filter(p => p.status === 'PENDING' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).map(p => p.customer)).size,
                                charges: payments.filter(p => p.status === 'PENDING' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).length,
                                type: 'solid'
                            },
                            {
                                statusKey: 'OVERDUE',
                                label: 'Vencidas',
                                value: payments.filter(p => p.status === 'OVERDUE' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).reduce((acc, curr) => acc + curr.value, 0),
                                color: 'rose',
                                clients: new Set(payments.filter(p => p.status === 'OVERDUE' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).map(p => p.customer)).size,
                                charges: payments.filter(p => p.status === 'OVERDUE' && (filterMonth === 'ALL' || p.dueDate?.startsWith(filterMonth))).length,
                                type: 'striped'
                            }
                        ].map((card, i) => (
                            <div
                                key={i}
                                onClick={() => setFilterStatus(card.statusKey === 'RECEIVED' ? 'RECEIVED' : card.statusKey)}
                                className="bg-white border border-slate-100 rounded-xl p-3 hover:border-blue-200 hover:shadow-md transition-all group flex flex-col cursor-pointer"
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{card.label}</span>
                                    <ArrowRight size={10} className="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="mb-2">
                                    <h4 className={`text-base font-black ${card.color === 'emerald' ? 'text-emerald-600' : card.color === 'rose' ? 'text-rose-500' : card.color === 'orange' ? 'text-orange-500' : 'text-blue-600'}`}>
                                        {formatCurrency(card.value)}
                                    </h4>
                                    <p className="text-[8px] text-slate-400 font-bold uppercase">{formatCurrency(card.value * 1)} bruto</p>
                                </div>

                                <div className="space-y-1 mt-auto pt-2 border-t border-slate-50">
                                    <div className="flex justify-between items-center text-slate-500">
                                        <div className="flex items-center gap-1">
                                            <User size={10} className="text-slate-300" />
                                            <span className="text-[9px] font-bold">{card.clients} {card.clients === 1 ? 'cli' : 'cli'}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <CreditCard size={10} className="text-slate-300" />
                                            <span className="text-[9px] font-bold">{card.charges} cob</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Filters & Actions Integrated Bar */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                    {/* Filter Tabs */}
                    <div className="lg:col-span-4 flex bg-slate-100 p-1 rounded-xl w-fit">
                        {[
                            { id: 'ALL', label: 'TUDO' },
                            { id: 'PENDING', label: 'AGUARD.' },
                            { id: 'RECEIVED', label: 'PAGOS' },
                            { id: 'OVERDUE', label: 'VENC.' }
                        ].map(status => (
                            <button
                                key={status.id}
                                onClick={() => setFilterStatus(status.id)}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all ${filterStatus === status.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                {status.label}
                            </button>
                        ))}
                    </div>

                    {/* Search and Month Filter */}
                    <div className="lg:col-span-8 flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-100 shadow-sm">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input
                                type="text"
                                placeholder="Buscar por cliente ou descrição..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-3 py-1.5 bg-transparent text-[11px] font-medium focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="lg:col-span-4 flex justify-end gap-2">
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-100 hover:bg-slate-50 text-blue-600 rounded-xl transition-all shadow-sm active:scale-95 text-[10px] font-black uppercase tracking-widest"
                        >
                            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                            Atualizar
                        </button>
                    </div>
                </div>

                {/* Transactions and Charges Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Latest Activity */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col h-[320px]">
                        <div className="flex justify-between items-center mb-3 shrink-0">
                            <h3 className="text-[10px] font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-widest">
                                <span className="w-0.5 h-2.5 bg-emerald-400 rounded-full"></span>
                                Extrato
                            </h3>
                            <button className="text-blue-500 font-bold text-[8px] hover:underline uppercase tracking-tighter">Histórico</button>
                        </div>
                        <div className="space-y-0.5 overflow-y-auto pr-1 custom-scrollbar flex-1">
                            {transactions.length === 0 ? (
                                <p className="text-center text-slate-400 py-6 text-[9px]">Sem movimentações.</p>
                            ) : (
                                transactions.map((t, idx) => (
                                    <div key={t.id || idx} className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-50 transition-colors border border-transparent">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${t.value < 0 ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-500'}`}>
                                                {t.value < 0 ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-700 text-[10px] truncate">{t.description || 'Transação Asaas'}</p>
                                                <p className="text-[8px] text-slate-400 font-medium">
                                                    {new Date(t.date).toLocaleDateString('pt-BR')}
                                                </p>
                                            </div>
                                        </div>
                                        <div className={`font-black text-[10px] text-right shrink-0 ${t.value < 0 ? 'text-slate-600' : 'text-emerald-600'}`}>
                                            {formatCurrency(t.value)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Charges Management */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col h-[320px]">
                        <div className="flex justify-between items-center mb-3 shrink-0">
                            <h3 className="text-[10px] font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-widest">
                                <span className="w-0.5 h-2.5 bg-blue-400 rounded-full"></span>
                                Cobranças {filteredPayments.length > 0 && <span className="text-blue-200">({filteredPayments.length})</span>}
                            </h3>
                        </div>

                        <div className="space-y-1.5 overflow-y-auto pr-1 custom-scrollbar flex-1">
                            {filteredPayments.length === 0 ? (
                                <p className="text-center text-slate-400 py-6 text-[9px]">Nenhuma cobrança.</p>
                            ) : (
                                filteredPayments.map((p) => {
                                    const style = getStatusStyle(p.status);
                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => handleViewPaymentDetails(p)}
                                            className="p-2.5 rounded-xl border border-slate-50 hover:border-blue-100 hover:bg-blue-50/10 transition-all cursor-pointer group"
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className={`px-1.5 py-0.5 rounded-full text-[7px] font-black uppercase tracking-tight flex items-center gap-0.5 ${style.bg} ${style.text}`}>
                                                    {style.icon}
                                                    {p.status}
                                                </span>
                                                <span className="text-slate-400 text-[8px] font-bold">Venc. {new Date(p.dueDate).toLocaleDateString('pt-BR')}</span>
                                            </div>
                                            <div className="flex justify-between items-end">
                                                <div className="min-w-0">
                                                    <p className="font-black text-slate-800 text-[10px] truncate">{p.customerName || 'Cliente'}</p>
                                                    <p className="text-[8px] text-slate-400 font-medium truncate max-w-[150px]">{p.description || 'Aluguel'}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-slate-900 font-black text-[11px]">{formatCurrency(p.value)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Pix Modal */}
                {showPixModal && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
                        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-scale-up">
                            <div className="bg-slate-900 px-6 py-5 flex justify-between items-center text-white">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center font-black italic text-[10px] text-slate-900">pix</div>
                                    <h3 className="text-base font-black">
                                        {pixStep === 'SELECT' && 'Minhas Contas'}
                                        {pixStep === 'AMOUNT' && 'Quanto transferir?'}
                                        {pixStep === 'CONFIRM' && 'Confirmar'}
                                    </h3>
                                </div>
                                <button onClick={() => setShowPixModal(false)} className="text-white/40 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-xl">
                                    <ArrowRight className="rotate-45" size={20} />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                {pixStep === 'SELECT' && (
                                    <>
                                        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                            <p className="text-emerald-800 text-[10px] font-bold leading-tight uppercase tracking-tight">
                                                Selecione uma de suas contas para transferência.
                                            </p>
                                        </div>
                                        <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
                                            {pixKeys.length === 0 ? (
                                                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                                    <p className="text-slate-400 text-[10px] font-black uppercase">Nenhuma chave pix ativa</p>
                                                </div>
                                            ) : (
                                                pixKeys.map(key => (
                                                    <button
                                                        key={key.id}
                                                        onClick={() => {
                                                            setSelectedPixKey(key);
                                                            setPixStep('AMOUNT');
                                                        }}
                                                        className="w-full p-4 bg-white border border-slate-100 rounded-2xl flex items-center gap-4 group hover:border-emerald-500 hover:shadow-md transition-all text-left"
                                                    >
                                                        <div className={`w-12 h-12 rounded-2xl ${getBankBrand(key.bankName).color} flex items-center justify-center shrink-0 overflow-hidden shadow-inner`}>
                                                            {getBankBrand(key.bankName).domain ? (
                                                                <img
                                                                    src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(key.bankName).domain}`}
                                                                    alt={key.bankName}
                                                                    className="w-8 h-8 object-contain"
                                                                    onError={(e) => {
                                                                        (e.target as any).style.display = 'none';
                                                                        (e.target as any).parentElement.innerText = getBankBrand(key.bankName).initials;
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span className="text-white font-black text-xs">{getBankBrand(key.bankName).initials}</span>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex justify-between items-start mb-1">
                                                                <p className={`text-[10px] font-black ${getBankBrand(key.bankName).text} uppercase tracking-wider`}>{key.bankName}</p>
                                                                {key.type === 'BANK_ACCOUNT' ? (
                                                                    <span className="bg-blue-50 text-blue-600 text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase">Conta</span>
                                                                ) : (
                                                                    <span className="bg-emerald-50 text-emerald-600 text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase">Pix</span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs font-black text-slate-900 truncate">{key.ownerName}</p>
                                                            <p className="text-[10px] text-slate-400 font-bold truncate mt-0.5 opacity-60">
                                                                {key.type === 'BANK_ACCOUNT' ? `Ag: ${key.agency} Cc: ${key.account}` : key.key}
                                                            </p>
                                                        </div>
                                                        <ChevronRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0" />
                                                    </button>
                                                ))
                                            )}
                                        </div>

                                        <button
                                            onClick={() => setShowPixModal(false)}
                                            className="w-full bg-slate-900/5 text-slate-400 py-4 rounded-2xl font-black text-xs hover:bg-slate-900/10 transition-all uppercase tracking-widest"
                                        >
                                            Cancelar
                                        </button>
                                    </>
                                )}

                                {pixStep === 'AMOUNT' && (
                                    <div className="space-y-6">
                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl ${getBankBrand(selectedPixKey?.bankName).color} flex items-center justify-center overflow-hidden`}>
                                                {getBankBrand(selectedPixKey?.bankName).domain ? (
                                                    <img
                                                        src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(selectedPixKey?.bankName).domain}`}
                                                        className="w-6 h-6 object-contain"
                                                        alt=""
                                                    />
                                                ) : (
                                                    <span className="text-white font-black text-xs">{getBankBrand(selectedPixKey?.bankName).initials}</span>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Para: {selectedPixKey?.bankName}</p>
                                                <p className="text-xs font-black text-slate-900 truncate">{selectedPixKey?.ownerName}</p>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xl">R$</div>
                                            <input
                                                type="number"
                                                autoFocus
                                                value={transferAmount}
                                                onChange={(e) => setTransferAmount(e.target.value)}
                                                placeholder="0,00"
                                                className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 focus:ring-0 rounded-2xl py-6 pl-12 pr-6 text-3xl font-black text-slate-800 transition-all text-center"
                                            />
                                        </div>

                                        <button
                                            disabled={!transferAmount || parseFloat(transferAmount) <= 0 || (balance !== null && parseFloat(transferAmount) > balance)}
                                            onClick={() => setPixStep('CONFIRM')}
                                            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm hover:bg-slate-800 disabled:bg-slate-200 disabled:cursor-not-allowed transition-all shadow-xl shadow-slate-900/20 uppercase tracking-widest"
                                        >
                                            Continuar
                                        </button>
                                        <button onClick={() => setPixStep('SELECT')} className="w-full text-slate-400 py-1 font-bold text-[10px] uppercase hover:text-slate-600 transition-colors">
                                            Voltar
                                        </button>
                                    </div>
                                )}

                                {pixStep === 'CONFIRM' && (
                                    <div className="space-y-6">
                                        <div className="bg-slate-900 rounded-[1.5rem] p-6 text-white relative overflow-hidden">
                                            <div className="absolute top-[-20px] right-[-20px] w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl"></div>

                                            <div className="flex items-center gap-3 mb-4">
                                                <div className={`w-10 h-10 rounded-xl ${getBankBrand(selectedPixKey?.bankName).color} flex items-center justify-center overflow-hidden`}>
                                                    {getBankBrand(selectedPixKey?.bankName).domain ? (
                                                        <img
                                                            src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(selectedPixKey?.bankName).domain}`}
                                                            className="w-6 h-6 object-contain grayscale brightness-200"
                                                            alt=""
                                                        />
                                                    ) : (
                                                        <span className="text-white font-black text-xs">{getBankBrand(selectedPixKey?.bankName).initials}</span>
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em]">Resumo do Pix</p>
                                                    <h4 className="text-2xl font-black">{formatCurrency(parseFloat(transferAmount))}</h4>
                                                </div>
                                            </div>

                                            <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[9px] font-bold text-white/40 uppercase">Banco</span>
                                                    <span className="text-[11px] font-black text-emerald-400">{selectedPixKey?.bankName}</span>
                                                </div>
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[9px] font-bold text-white/40 uppercase">Destinatário</span>
                                                    <span className="text-[11px] font-black">{selectedPixKey?.ownerName}</span>
                                                </div>
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[9px] font-bold text-white/40 uppercase">{selectedPixKey?.type === 'BANK_ACCOUNT' ? 'Conta' : 'Chave Pix'}</span>
                                                    <span className="text-[11px] font-black">{selectedPixKey?.type === 'BANK_ACCOUNT' ? `${selectedPixKey.agency}/${selectedPixKey.account}` : selectedPixKey?.key}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            disabled={isTransferring}
                                            onClick={async () => {
                                                setIsTransferring(true);
                                                try {
                                                    const isPix = selectedPixKey.type !== 'BANK_ACCOUNT';

                                                    await transferPix(
                                                        parseFloat(transferAmount),
                                                        isPix ? selectedPixKey.key : undefined,
                                                        isPix ? selectedPixKey.type : undefined,
                                                        selectedPixKey.bankAccountId
                                                    );

                                                    showToast('Transferência realizada!', 'success');
                                                    setShowPixModal(false);
                                                    fetchData();
                                                } catch (error) {
                                                    console.error('DEBUG: Error performing transfer:', error);
                                                    showToast('Erro ao transferir', 'error');
                                                } finally {
                                                    setIsTransferring(false);
                                                }
                                            }}
                                            className="w-full bg-emerald-500 text-white py-5 rounded-2xl font-black text-sm hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-500/20 active:scale-95 uppercase tracking-widest flex items-center justify-center gap-2"
                                        >
                                            {isTransferring ? (
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            ) : (
                                                <>Confirmar Pix <ChevronRight size={16} /></>
                                            )}
                                        </button>
                                        <button onClick={() => setPixStep('AMOUNT')} className="w-full text-slate-400 py-1 font-bold text-[10px] uppercase hover:text-slate-600 transition-colors">
                                            Voltar e ajustar valor
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Payment Details Modal */}
                {selectedPayment && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[101] flex items-center justify-center p-4 animate-fade-in">
                        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col transform transition-all animate-scale-up border border-slate-100">
                            <div className="bg-slate-900 px-6 py-5 flex justify-between items-center text-white shrink-0">
                                <div>
                                    <p className="text-emerald-400 font-bold text-[10px] uppercase tracking-[0.2em] mb-1">Detalhes da Cobrança</p>
                                    <h3 className="text-base font-black truncate max-w-[300px]">{selectedPayment.customerName || 'Informações Gerais'}</h3>
                                </div>
                                <button onClick={() => setSelectedPayment(null)} className="text-white/40 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-xl">
                                    <ArrowRight className="rotate-45" size={20} />
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                                {/* Price Header */}
                                <div className="flex justify-between items-center pb-6 border-b border-slate-100">
                                    <div>
                                        <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Valor Total</p>
                                        <p className="text-3xl font-black text-slate-900">{formatCurrency(selectedPayment.value)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Vencimento</p>
                                        <p className={`text-xl font-black ${selectedPayment.status === 'OVERDUE' ? 'text-rose-500' : 'text-slate-900'}`}>
                                            {new Date(selectedPayment.dueDate).toLocaleDateString('pt-BR')}
                                        </p>
                                    </div>
                                </div>

                                {isDetailsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                                        <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest animate-pulse">Consultando histórico...</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Status Badge */}
                                        <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getStatusStyle(selectedPayment.status).bg} ${getStatusStyle(selectedPayment.status).text}`}>
                                                {getStatusStyle(selectedPayment.status).icon}
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status Atual</p>
                                                <p className="text-xs font-black text-slate-900 uppercase">{selectedPayment.status}</p>
                                            </div>
                                        </div>

                                        {/* Descontos */}
                                        {selectedPayment.discount && (
                                            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
                                                <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-blue-500/20">
                                                    <Zap size={20} />
                                                </div>
                                                <div>
                                                    <p className="font-black text-blue-900 text-[10px] uppercase tracking-widest mb-0.5">Desconto disponível</p>
                                                    <p className="text-[11px] font-bold text-blue-700 leading-tight">
                                                        {formatCurrency(selectedPayment.discount.value)} para pagamentos realizados até {new Date(selectedPayment.discount.limitDate).toLocaleDateString('pt-BR')}.
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                                            {/* Histórico */}
                                            <div className="space-y-5">
                                                <h4 className="font-black text-slate-900 text-[10px] uppercase tracking-[0.2em] flex items-center gap-2">
                                                    Histórico
                                                </h4>
                                                <div className="space-y-4 relative">
                                                    {paymentDetails?.history.map((h, idx) => (
                                                        <div key={idx} className="flex gap-4 relative">
                                                            {idx !== paymentDetails.history.length - 1 && (
                                                                <div className="absolute left-[7px] top-4 bottom-[-16px] w-px bg-slate-100"></div>
                                                            )}
                                                            <div className="w-4 h-4 rounded-full border border-slate-200 bg-white flex items-center justify-center shrink-0 z-10">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                                            </div>
                                                            <div>
                                                                <p className="text-[11px] font-black text-slate-800 leading-tight">{h.event}</p>
                                                                <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{new Date(h.date).toLocaleString('pt-BR')}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {paymentDetails?.history.length === 0 && (
                                                        <p className="text-[10px] text-slate-400 italic">Nenhum evento registrado.</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Notificações */}
                                            <div className="space-y-5">
                                                <h4 className="font-black text-slate-900 text-[10px] uppercase tracking-[0.2em] flex items-center gap-2">
                                                    Notificações
                                                </h4>
                                                <div className="space-y-2">
                                                    {paymentDetails?.notifications.map((n, idx) => (
                                                        <div key={idx} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-start gap-3">
                                                            <div className="bg-white p-2 rounded-lg shrink-0 border border-slate-100">
                                                                <Bell size={12} className="text-slate-400" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-[10px] font-black text-slate-800 leading-tight truncate">{n.event}</p>
                                                                <p className="text-[9px] text-slate-400 font-bold uppercase truncate">{n.destination} • {new Date(n.scheduleDate).toLocaleDateString('pt-BR')}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {paymentDetails?.notifications.length === 0 && (
                                                        <p className="text-[10px] text-slate-400 italic">Sem notificações enviadas.</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0">
                                <div className="flex gap-3">
                                    {selectedPayment.invoiceUrl && (
                                        <a
                                            href={selectedPayment.invoiceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 bg-slate-900 text-white flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-[11px] hover:bg-slate-800 transition-all uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10"
                                        >
                                            Ver Fatura <ExternalLink size={14} />
                                        </a>
                                    )}
                                    <button
                                        onClick={() => setSelectedPayment(null)}
                                        className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[11px] hover:bg-slate-100 transition-all uppercase tracking-[0.2em]"
                                    >
                                        Fechar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Styles for the new tab */}
                <style>{`
                    @keyframes fade-in {
                        from { opacity: 0; transform: translateY(10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes scale-up {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                    .animate-fade-in {
                        animation: fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    }
                    .animate-scale-up {
                        animation: scale-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    }
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 4px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: #e2e8f0;
                        border-radius: 10px;
                    }
                    .bg-stripes {
                        background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.15) 50%, rgba(255, 255, 255, 0.15) 75%, transparent 75%, transparent);
                        background-size: 1rem 1rem;
                        animation: stripes-move 2s linear infinite;
                    }
                    @keyframes stripes-move {
                        from { background-position: 0 0; }
                        to { background-position: 1rem 0; }
                    }
                `}</style>
            </div>
        </div>
    );
};
