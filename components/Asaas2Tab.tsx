import React, { useState, useEffect, useMemo } from 'react';
import {
    Wallet, CreditCard, ArrowUpRight, ArrowDownLeft,
    Search, Filter, Calendar, Bell, Info, ChevronRight,
    DollarSign, CheckCircle2, Clock, AlertCircle, RefreshCcw,
    Zap, Droplets, Home, ExternalLink, MoreVertical,
    ArrowRight, Eye, EyeOff, User, FileText, BellOff, Trash2
} from 'lucide-react';
import { Tenant, Property, EnergyBill, WaterBill } from '../types';
import {
    getFinanceBalance,
    getFinancialTransactions,
    getPixAddressKeys,
    getPayments,
    transferPix,
    getBankAccounts,
    getMyAccount,
    formatReferenceMonth,
    getPaymentHistory,
    getPaymentNotifications,
    getNextMonth,
    createPayment,
    calculateDueDate,
    getCustomerByCpf,
    createCustomer,
    deletePayment,
    uploadPaymentDocument,
    getCustomers
} from '../services/asaasService';
import { requestNotificationPermission } from '../services/messagingService';
import { dbInstance } from '../services/firebaseConfig';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { Toast } from './Toast';
import { jsPDF } from 'jspdf';

interface Asaas2TabProps {
    tenants: Tenant[];
    properties: Property[];
    bills: EnergyBill[];
    waterBills: WaterBill[];
}

export const Asaas2Tab: React.FC<Asaas2TabProps> = ({ tenants, properties, bills, waterBills }) => {
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [nextMonthPayments, setNextMonthPayments] = useState<any[]>([]);
    const [customers, setCustomers] = useState<any[]>([]); // Adicionado
    const [pixKeys, setPixKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [filterMonth, setFilterMonth] = useState<string>(currentMonthStr);
    const [showPixModal, setShowPixModal] = useState(false);
    const [pixStep, setPixStep] = useState<'SELECT' | 'AMOUNT' | 'CONFIRM'>('SELECT');
    const [selectedPixKey, setSelectedPixKey] = useState<any | null>(null);
    const [manualPixKey, setManualPixKey] = useState('');
    const [transferAmount, setTransferAmount] = useState<string>('');
    const [isTransferring, setIsTransferring] = useState(false);
    const [showBalance, setShowBalance] = useState(true);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
    const [extratoFilter, setExtratoFilter] = useState<{ id: string, name: string } | null>(null);
    const [showPaymentsModal, setShowPaymentsModal] = useState(false);
    const [selectedPaymentForDetail, setSelectedPaymentForDetail] = useState<any | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
    const [detailTransactions, setDetailTransactions] = useState<any[]>([]);
    const [detailNotifications, setDetailNotifications] = useState<any[]>([]);
    const [showTransactionsModal, setShowTransactionsModal] = useState(false);
    const [transTypeFilter, setTransTypeFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
    const [notificationsEnabled, setNotificationsEnabled] = useState(Notification.permission === 'granted');
    const [activeTab, setActiveTab] = useState<'dashboard' | 'prep'>('dashboard');
    const [loadingCharge, setLoadingCharge] = useState<string | null>(null);
    const [createdCharges, setCreatedCharges] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('asaas-created-charges');
        return saved ? JSON.parse(saved) : {};
    });
    const DISCOUNT_VALUE = 50;

    const showToast = (message: string, type: 'success' | 'error' | 'info') => {
        setToast({ message, type });
    };

    const fetchData = async () => {
        if (!filterMonth) return;
        setLoading(true);
        try {
            const nextMonth = getNextMonth(filterMonth === 'ALL' ? currentMonthStr : filterMonth);

            const [balanceRes, transRes, paymentsRes, nextPaymentsRes, customersRes] = await Promise.all([
                getFinanceBalance(),
                getFinancialTransactions({ limit: 500 }),
                getPayments({ dueDate: filterMonth === 'ALL' ? undefined : filterMonth }),
                getPayments({ dueDate: nextMonth }),
                getCustomers({ limit: 100 })
            ]);

            setBalance(balanceRes.balance);
            setTransactions(transRes.data);
            setPayments(paymentsRes.data);
            setNextMonthPayments(nextPaymentsRes.data);
            setCustomers(customersRes.data);

            // Lógica para limpar cache local de cobranças excluídas (IDÊNTICA ao AsaasTab)
            const allFetchedIds = new Set([
                ...paymentsRes.data.map((p: any) => p.id),
                ...nextPaymentsRes.data.map((p: any) => p.id)
            ]);

            if (paymentsRes.totalCount <= 100 && nextPaymentsRes.totalCount <= 100) {
                setCreatedCharges(prev => {
                    const next = { ...prev };
                    let changed = false;
                    Object.entries(next).forEach(([key, paymentId]) => {
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
        } catch (error) {
            console.error('Error fetching Asaas 2 data:', error);
            showToast('Erro ao carregar dados do Asaas', 'error');
        } finally {
            setLoading(false);
        }
    };



    useEffect(() => {
        fetchData();
    }, [filterMonth]);

    // Validação de CPF (algoritmo oficial dos dígitos verificadores)
    const isValidCpf = (cpf: string): boolean => {
        const digits = cpf.replace(/\D/g, '');
        if (digits.length !== 11) return false;
        if (/^(\d)\1{10}$/.test(digits)) return false; // todos iguais
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += parseInt(digits.charAt(i)) * (10 - i);
        let rem = (sum * 10) % 11;
        if (rem === 10) rem = 0;
        if (rem !== parseInt(digits.charAt(9))) return false;
        sum = 0;
        for (let i = 0; i < 10; i++) sum += parseInt(digits.charAt(i)) * (11 - i);
        rem = (sum * 10) % 11;
        if (rem === 10) rem = 0;
        return rem === parseInt(digits.charAt(10));
    };

    const detectPixType = (key: string): string => {
        const clean = key.replace(/\s/g, '');
        if (clean.includes('@')) return 'EMAIL';

        // Verifica se é um UUID (Chave Aleatória / EVP) antes de contar os dígitos
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
        if (isUUID) return 'EVP';

        if (clean.startsWith('+')) return 'PHONE';

        const digits = clean.replace(/\D/g, '');
        if (digits.length === 14) return 'CNPJ';
        if (digits.length === 12 || digits.length === 13) return 'PHONE';

        // 10 ou 11 dígitos: CPF ou Telefone?
        if (digits.length === 10 || digits.length === 11) {
            // Se tem separadores de CPF (. ou -), é CPF
            if (key.includes('.') || key.includes('-')) return 'CPF';
            // Se 11 dígitos e passa na validação de CPF, é CPF
            if (digits.length === 11 && isValidCpf(digits)) return 'CPF';
            // Senão, assume telefone
            return 'PHONE';
        }

        // Qualquer outra coisa sem detecção óbvia será considerada EVP (Endereço Virtual de Pagamento)
        return 'EVP';
    };

    // Formata chave Pix para exibição visual (não afeta o valor enviado à API)
    const formatPixKeyDisplay = (key: string, keyType?: string): string => {
        if (!key) return '';
        const digits = key.replace(/\D/g, '');

        // Se sabemos o tipo, formatar de acordo
        if (keyType === 'PHONE') {
            if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
            if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
            return key;
        }
        if (keyType === 'CPF' && digits.length === 11) {
            return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        if (keyType === 'CNPJ' && digits.length === 14) {
            return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }

        // Fallback: sem tipo, usar validação de CPF para decidir
        if (digits.length === 11 && digits === key && isValidCpf(digits)) {
            return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        if (digits.length === 14 && digits === key) {
            return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }
        return key;
    };

    const handleFetchPixKeys = async () => {
        try {
            // Buscar contas bancárias externas, chaves Pix salvas e dados da própria conta
            const [bankRes, myAccRes, pixKeysSnapshot] = await Promise.all([
                getBankAccounts(),
                getMyAccount(),
                getDocs(collection(dbInstance, 'pix_keys'))
            ]);

            const myCpf = myAccRes.cpfCnpj || '';
            const myPhone = myAccRes.mobilePhone || '';
            const myEmail = myAccRes.email || '';

            // Buscar chaves Pix salvas no Firestore
            const savedPixKeys: Record<string, { key: string, type?: string }> = {};
            pixKeysSnapshot.docs.forEach(d => {
                const data = d.data();
                savedPixKeys[d.id] = { key: data.pixKey, type: data.pixKeyType };
            });

            // Mapear contas bancárias externas (excluindo Asaas)
            const bankItems = bankRes.data
                .filter((b: any) => {
                    const name = (b.financialInstitutionName || b.bankName || '').toUpperCase();
                    const code = (b.bankCode || '').toString();
                    return !(name.includes('ASAAS') || code === '461');
                })
                .map((b: any) => {
                    const accountId = b.id || (b.bankAccountInfoId ? b.bankAccountInfoId.toString() : '');
                    const savedEntry = savedPixKeys[accountId];
                    let pixKey = savedEntry?.key || b.pixKey || '';
                    let hasRealPixKey = !!savedEntry;
                    let pixKeyType = savedEntry?.type || ''; // Tipo salvo no Firestore

                    // Sanitizar chaves Pix salvas anteriormente com formatação (CPF: 123.456.789-01 → 12345678901)
                    if (hasRealPixKey && pixKey) {
                        const digitsOnly = pixKey.replace(/\D/g, '');
                        if ((digitsOnly.length === 11 || digitsOnly.length === 14) && pixKey !== digitsOnly && !pixKey.includes('@')) {
                            pixKey = digitsOnly;
                        }
                    }
                    const rawOwnerName = (b.accountName || b.name || '').trim();
                    const ownerName = rawOwnerName.toUpperCase();
                    const myNameUpper = (myAccRes.name || '').toUpperCase().trim();
                    const firstName = myNameUpper.split(' ')[0] || 'ROGERIO';

                    const isMyAccount = ownerName.includes(firstName);

                    let isGuessed = false;
                    const cleanPhone = myPhone.replace(/\D/g, '');
                    const cleanCpf = myCpf.replace(/\D/g, '');

                    if (!hasRealPixKey && pixKey) {
                        // Se qualquer máscara for identificada, consideramos como uma ADIVINHAÇÃO (isGuessed = true)

                        // 1. Identificar se é TELEFONE (contém * ou X ou ( e termina com números)
                        const looksLikePhone = (pixKey.includes('*') || pixKey.includes('X') || (pixKey.includes('(') && pixKey.includes(')'))) && pixKey.match(/\d+$/);

                        if (looksLikePhone) {
                            const lastFour = pixKey.match(/(\d+)$/)?.[1] || '';
                            if (cleanPhone && cleanPhone.endsWith(lastFour)) {
                                pixKey = cleanPhone.startsWith('55') ? cleanPhone.substring(2) : cleanPhone;
                                pixKeyType = 'PHONE';
                                hasRealPixKey = true;
                                isGuessed = true;
                            }
                        }
                        // 2. Identificar se é E-MAIL
                        else if (pixKey.includes('@')) {
                            if (isMyAccount && myEmail) {
                                pixKey = myEmail;
                                pixKeyType = 'EMAIL';
                                hasRealPixKey = true;
                                isGuessed = true;
                            }
                        }
                        // 3. Fallback p/ CPF (contém * ou X)
                        else if (pixKey.includes('*') || pixKey.includes('X')) {
                            const maskDigits = pixKey.match(/\d+/g)?.join('') || '';
                            if (cleanCpf && (maskDigits === '' || cleanCpf.includes(maskDigits))) {
                                pixKey = cleanCpf;
                                pixKeyType = cleanCpf.length === 11 ? 'CPF' : 'CNPJ';
                                hasRealPixKey = true;
                                isGuessed = true;
                            }
                        }
                    }

                    // Se é sua conta e ainda não tem chave real detectada, usamos CPF como última chance
                    if (isMyAccount && !hasRealPixKey) {
                        if (cleanCpf) {
                            pixKey = cleanCpf;
                            pixKeyType = cleanCpf.length === 11 ? 'CPF' : 'CNPJ';
                            hasRealPixKey = true;
                            isGuessed = true;
                        }
                    }

                    // Se tem chave mas não tem tipo, detectar agora
                    if (hasRealPixKey && pixKey && !pixKeyType) {
                        pixKeyType = detectPixType(pixKey);
                    }



                    return {
                        id: accountId,
                        key: pixKey,
                        type: 'PIX_BANK',
                        pixKeyType: pixKeyType,
                        bankName: b.financialInstitutionName || b.bankName || 'Banco',
                        bankCode: b.bankCode || '',
                        ownerName: rawOwnerName || 'Conta Própria',
                        bankAccountId: accountId,
                        hasRealPixKey: hasRealPixKey,
                        isGuessed: isGuessed
                    };
                });

            setPixKeys(bankItems);
            setPixStep('SELECT');
            setSelectedPixKey(null);
            setTransferAmount('');
            setShowPixModal(true);
        } catch (error) {
            showToast('Erro ao carregar contas de destino', 'error');
        }
    };

    const handleTransferConfirm = async () => {
        if (!transferAmount || parseFloat(transferAmount.replace(',', '.')) <= 0) {
            showToast('Informe um valor válido', 'error');
            return;
        }

        if (!selectedPixKey) {
            showToast('Selecione uma conta', 'error');
            return;
        }

        if (isTransferring) return;

        try {
            setIsTransferring(true);
            const value = parseFloat(transferAmount.replace(',', '.'));

            // DEFINIR CHAVE A USAR E SALVAR (se alterada ou adivinhada)
            let pixKeyToUse = selectedPixKey.hasRealPixKey ? selectedPixKey.key : manualPixKey.trim();

            if (!pixKeyToUse) {
                showToast('Informe uma chave Pix válida', 'error');
                return;
            }

            // Usar o tipo salvo (pixKeyType) ou re-detectar como fallback
            const pixType = selectedPixKey.pixKeyType || detectPixType(pixKeyToUse);

            // AUTO-FORMATAÇÃO: Remover caracteres não numéricos para tipos que exigem apenas dígitos
            if (pixType === 'PHONE') {
                let digitsOnly = pixKeyToUse.replace(/\D/g, '');
                if (digitsOnly.startsWith('55') && digitsOnly.length > 11) {
                    digitsOnly = digitsOnly.substring(2);
                }
                pixKeyToUse = digitsOnly;
            } else if (pixType === 'CPF' || pixType === 'CNPJ') {
                // A API do Asaas exige CPF/CNPJ apenas com dígitos (sem pontos, hífens ou barras)
                pixKeyToUse = pixKeyToUse.replace(/\D/g, '');
            }

            // Salvar no Firestore se for uma Chave Manual ou se era uma Adivinhação
            if (selectedPixKey.type === 'PIX_BANK' && (!selectedPixKey.hasRealPixKey || selectedPixKey.isGuessed) && pixKeyToUse) {
                await setDoc(doc(dbInstance, 'pix_keys', selectedPixKey.bankAccountId || selectedPixKey.id), {
                    pixKey: pixKeyToUse,
                    pixKeyType: pixType,
                    bankName: selectedPixKey.bankName,
                    updatedAt: new Date().toISOString()
                });
            }

            // PRIORIDADE: Transferimos usando a chave Pix (obrigatório para PIX entre contas próprias)
            await transferPix(value, pixKeyToUse, pixType, { id: selectedPixKey.bankAccountId } as any);

            showToast('Transferência solicitada com sucesso!', "success");
            setShowPixModal(false);
            setTransferAmount('');
            setManualPixKey('');
            fetchData();

        } catch (error: any) {
            console.error('Erro na transferência:', error);
            let msg = 'Erro ao realizar transferência.';

            if (error.message?.includes('já solicitado')) {
                showToast('Esta transferência já foi processada.', "info");
                setShowPixModal(false);
                return;
            }

            try {
                const rawError = error.message.replace('Asaas API error: ', '').replace('Asaas Transfer API error: ', '');
                const errObj = JSON.parse(rawError);
                if (errObj.errors && errObj.errors[0]) {
                    msg = errObj.errors[0].description;
                }
            } catch (e) { }

            showToast(msg, "error");
        } finally {
            setIsTransferring(false);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showDetailModal) {
                    setShowDetailModal(false);
                } else if (showTransactionsModal) {
                    setShowTransactionsModal(false);
                } else if (showPaymentsModal) {
                    setShowPaymentsModal(false);
                    setFilterStatus('ALL');
                } else if (showPixModal) {
                    setShowPixModal(false);
                }
            }
            if (showPixModal && pixStep === 'CONFIRM' && e.key === 'Enter' && !isTransferring) {
                handleTransferConfirm();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showPixModal, pixStep, isTransferring, selectedPixKey, transferAmount, showPaymentsModal, showDetailModal, showTransactionsModal]);

    const handleViewPaymentDetails = async (payment: any) => {
        // Obter o nome real para o filtro
        const tenant = tenants.find(t => t.asaasCustomerId === payment.customer);
        const displayName = tenant?.name || payment.customerName || '';

        // Ativar o filtro no extrato
        setExtratoFilter({ id: payment.id, name: displayName });
    };

    const handleOpenPaymentDetail = (payment: any) => {
        setSelectedPaymentForDetail(payment);
        setShowDetailModal(true);
    };

    const getBankBrand = (name: string = '', code: string = '') => {
        const n = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove acentos
        const c = code.toString().padStart(3, '0');

        if (n.includes('ASAAS') || c === '461') return { color: 'bg-[#00D68F]', text: 'text-[#00D68F]', domain: 'asaas.com', initials: 'AS' };
        if (n.includes('ITAU') || c === '341') return { color: 'bg-[#EC7000]', text: 'text-[#EC7000]', domain: 'itau.com.br', initials: 'IT' };
        if (n.includes('MERCADO PAGO') || n.includes('MERCADOPAGO') || c === '323') return { color: 'bg-[#009EE3]', text: 'text-[#009EE3]', domain: 'mercadopago.com.br', initials: 'MP' };
        if (n.includes('NUBANK') || c === '260') return { color: 'bg-[#8A05BE]', text: 'text-[#8A05BE]', domain: 'nubank.com.br', initials: 'NU' };
        if (n.includes('BRADESCO') || c === '237') return { color: 'bg-[#CC092F]', text: 'text-[#CC092F]', domain: 'bradesco.com.br', initials: 'BR' };
        if (n.includes('SANTANDER') || c === '033') return { color: 'bg-[#EC0000]', text: 'text-[#EC0000]', domain: 'santander.com.br', initials: 'SA' };
        if (n.includes('BANCO DO BRASIL') || n.includes(' BANCO DO BRASIL') || c === '001') return { color: 'bg-[#F8D117]', text: 'text-[#F8D117]', domain: 'bb.com.br', initials: 'BB' };
        if (n.includes('CAIXA') || c === '104') return { color: 'bg-[#00509F]', text: 'text-[#00509F]', domain: 'caixa.gov.br', initials: 'CE' };
        if (n.includes('INTER') || c === '077') return { color: 'bg-[#FF7A00]', text: 'text-[#FF7A00]', domain: 'bancointer.com.br', initials: 'IN' };
        if (n.includes('SAFRA') || c === '422') return { color: 'bg-[#C59B51]', text: 'text-[#C59B51]', domain: 'safra.com.br', initials: 'SA' };
        if (n.includes('C6') || c === '336') return { color: 'bg-[#000000]', text: 'text-[#000000]', domain: 'c6bank.com.br', initials: 'C6' };

        return { color: 'bg-slate-700', text: 'text-slate-400', domain: '', initials: name.substring(0, 2).toUpperCase() || 'BK' };
    };

    const [searchTerm, setSearchTerm] = useState('');

    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        const now = new Date();

        // Garantir os próximos 5 meses (incluindo o atual)
        for (let i = 0; i < 5; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months.add(mStr);
        }

        bills?.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
        waterBills?.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));

        payments.forEach(p => {
            if (p.dueDate) months.add(p.dueDate.substring(0, 7));
            if (p.paymentDate) months.add(p.paymentDate.substring(0, 7));
            if (p.clientPaymentDate) months.add(p.clientPaymentDate.substring(0, 7));
        });
        return Array.from(months).sort().reverse();
    }, [payments, bills, waterBills]);

    // Calcular estatísticas unificadas
    const stats = useMemo(() => {
        const s: Record<string, { count: number, total: number, label: string, color: string, gradient: string, icon: React.ReactNode, clients: number }> = {
            RECEIVED: { count: 0, total: 0, label: 'Recebidas', color: 'bg-emerald-500', gradient: 'from-emerald-400 to-teal-600', icon: <CheckCircle2 size={20} />, clients: 0 },
            CONFIRMED: { count: 0, total: 0, label: 'Confirmadas', color: 'bg-indigo-500', gradient: 'from-indigo-400 to-blue-700', icon: <CreditCard size={20} />, clients: 0 },
            PENDING: { count: 0, total: 0, label: 'Aguardando', color: 'bg-amber-500', gradient: 'from-amber-300 to-orange-500', icon: <Clock size={20} />, clients: 0 },
            OVERDUE: { count: 0, total: 0, label: 'Vencidas', color: 'bg-rose-500', gradient: 'from-rose-400 to-red-700', icon: <AlertCircle size={20} />, clients: 0 }
        };

        const clientSets: Record<string, Set<string>> = {
            RECEIVED: new Set(),
            CONFIRMED: new Set(),
            PENDING: new Set(),
            OVERDUE: new Set()
        };

        payments.forEach(p => {
            let status = p.status;
            if (status === 'RECEIVED_IN_CASH') status = 'RECEIVED';

            if (s[status]) {
                const monthMatch = (p.paymentDate || p.clientPaymentDate || p.dueDate)?.startsWith(filterMonth);
                if (filterMonth === 'ALL' || monthMatch) {
                    s[status].count++;
                    s[status].total += p.value;
                    clientSets[status].add(p.customer);
                }
            }
        });

        // Atualizar contagem de clientes
        Object.keys(clientSets).forEach(key => {
            s[key].clients = clientSets[key].size;
        });

        return s;
    }, [payments, filterMonth]);

    // --- Prep Table Logic (Migrated from AsaasTab) ---
    const getPreviousMonth = (monthStr: string) => {
        if (!monthStr || !monthStr.includes('-')) return null;
        try {
            const [year, month] = monthStr.split('-').map(Number);
            const date = new Date(year, month - 1 - 1, 1);
            return date.toISOString().slice(0, 7);
        } catch (e) { return null; }
    };

    const readingsMap = useMemo(() => {
        const map = new Map<string, Map<string, EnergyBill>>();
        bills?.filter(b => b.currentReading !== undefined).forEach(b => {
            const propKey = b.propertyId || b.installationCode;
            if (!propKey) return;
            if (!map.has(propKey)) map.set(propKey, new Map());
            map.get(propKey)!.set(b.referenceMonth, b);
        });
        return map;
    }, [bills]);

    const waterReadingsMap = useMemo(() => {
        const map = new Map<string, Map<string, WaterBill>>();
        waterBills?.filter(b => b.currentReading !== undefined).forEach(b => {
            const propKey = b.propertyId || b.installationCode;
            if (!propKey) return;
            if (!map.has(propKey)) map.set(propKey, new Map());
            map.get(propKey)!.set(b.referenceMonth, b);
        });
        return map;
    }, [waterBills]);

    const classifiedGroups = useMemo(() => {
        const groups = new Map<string, any>();
        bills?.forEach(b => {
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
        waterBills?.forEach(b => {
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
        if (!filterMonth || filterMonth === 'ALL') return [];
        return classifiedGroups.filter(g => g.month === filterMonth);
    }, [classifiedGroups, filterMonth]);

    // --- Receipt Helpers ---
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
        if (t === 1) parts.push(teens[u]);
        else {
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
            } else result += numberToWordsPt(integerPart);
            result += integerPart === 1 ? ' real' : ' reais';
        }
        if (decimalPart > 0) {
            if (result) result += ' e ';
            result += numberToWordsPt(decimalPart) + (decimalPart === 1 ? ' centavo' : ' centavos');
        }
        return result;
    };

    const createProfessionalReceiptPDF = async (group: any, description: string, total: number) => {
        const docRes = new jsPDF({ orientation: 'landscape', format: 'a5' });
        const pageWidth = docRes.internal.pageSize.getWidth();
        const pageHeight = docRes.internal.pageSize.getHeight();
        const margin = 12;
        const primaryColor = [30, 41, 59];
        const accentColor = [59, 130, 246];
        const lightGray = [248, 250, 252];
        const darkGray = [71, 85, 105];

        docRes.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        docRes.rect(0, 0, pageWidth, 35, 'F');
        docRes.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        docRes.rect(0, 0, 6, 35, 'F');
        docRes.setTextColor(255, 255, 255);
        docRes.setFont("helvetica", "bold");
        docRes.setFontSize(22);
        docRes.text("RECIBO", margin + 8, 22);

        const tenant = tenants.find(t => t.id === group.property?.tenantId);
        const tenantName = tenant ? tenant.name : (group.property?.address || 'Inquilino');
        const valorExtenso = formatCurrencyPtExtenso(total);

        let yPos = 45;
        const colWidth = (pageWidth - (margin * 2) - 10) / 2;
        docRes.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
        docRes.roundedRect(margin, yPos, colWidth, 22, 2, 2, 'F');
        docRes.setFont("helvetica", "bold");
        docRes.setFontSize(8);
        docRes.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
        docRes.text("PAGADOR", margin + 4, yPos + 6);
        docRes.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        docRes.setFontSize(11);
        const splitTenant = docRes.splitTextToSize(tenantName.toUpperCase(), colWidth - 8);
        docRes.text(splitTenant, margin + 4, yPos + 13);

        docRes.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        docRes.roundedRect(margin + colWidth + 10, yPos, colWidth, 22, 2, 2, 'F');
        docRes.setTextColor(255, 255, 255);
        docRes.setFontSize(8);
        docRes.text("TOTAL PAGO", margin + colWidth + 14, yPos + 6);
        docRes.setFontSize(16);
        docRes.text(`R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin + colWidth + 14, yPos + 15);

        yPos += 32;
        docRes.setFont("helvetica", "bold");
        docRes.setFontSize(8);
        docRes.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
        docRes.text("DETALHAMENTO", margin, yPos);
        yPos += 4;
        docRes.setDrawColor(226, 232, 240);
        docRes.setLineWidth(0.1);
        docRes.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 6;
        docRes.setFontSize(9);
        docRes.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        docRes.text("Item", margin + 4, yPos);
        docRes.text("Referência", pageWidth / 2, yPos, { align: 'center' });
        docRes.text("Valor", pageWidth - margin - 4, yPos, { align: 'right' });
        yPos += 3;
        docRes.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 6;
        docRes.setFont("helvetica", "normal");
        docRes.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);

        const items: any[] = [];
        let rentRef = group.month;
        if (group.month && group.month.includes('-')) {
            const [y, m] = group.month.split('-').map(Number);
            const nextDate = new Date(y, m, 1);
            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            rentRef = `${monthNames[nextDate.getMonth()]} / ${nextDate.getFullYear()}`;
        }
        let utilsRef = group.month;
        if (group.month && group.month.includes('-')) {
            const [y, m] = group.month.split('-').map(Number);
            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            utilsRef = `${monthNames[m - 1]} / ${y}`;
        }
        if (group.property?.baseRent) items.push({ name: 'Aluguel', ref: rentRef, val: group.property.baseRent });
        const energyVal = group.energy?.total || 0;
        const waterVal = group.water?.total || 0;
        if (energyVal > 0 || waterVal > 0) items.push({ name: 'Energia / Água', ref: utilsRef, val: energyVal + waterVal });

        items.forEach(item => {
            docRes.text(item.name, margin + 4, yPos);
            docRes.text(item.ref, pageWidth / 2, yPos, { align: 'center' });
            docRes.text(`R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, pageWidth - margin - 4, yPos, { align: 'right' });
            yPos += 6;
        });

        docRes.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 8;
        docRes.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        docRes.setFont("helvetica", "italic");
        docRes.setFontSize(8);
        const splitExtenso = docRes.splitTextToSize(`Valor por extenso: ${valorExtenso}.`, pageWidth - (margin * 2));
        docRes.text(splitExtenso, margin, yPos);

        yPos = pageHeight - 18;
        const todayAt = new Date();
        const dateStrAt = `${todayAt.getDate()} de ${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][todayAt.getMonth()]} de ${todayAt.getFullYear()}`;
        docRes.setFont("helvetica", "normal");
        docRes.setFontSize(9);
        docRes.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        docRes.text(`Salto, ${dateStrAt}`, margin, yPos);

        docRes.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        docRes.setLineWidth(0.2);
        docRes.line(pageWidth - margin - 70, yPos - 8, pageWidth - margin, yPos - 8);
        docRes.setFont("helvetica", "bold");
        docRes.setFontSize(9);
        docRes.text("Rogério Marcos Boitto", pageWidth - margin - 35, yPos - 4, { align: 'center' });
        docRes.setFontSize(8);
        docRes.text("160.024.608-70", pageWidth - margin - 35, yPos, { align: 'center' });
        docRes.setFontSize(7);
        docRes.setFont("helvetica", "normal");
        docRes.text("Pelo Emitente", pageWidth - margin - 35, yPos + 4, { align: 'center' });

        return { doc: docRes, tenantName };
    };

    const createUnifiedPDFDoc = async (group: any) => {
        const docRes = new jsPDF();
        const pageWidth = docRes.internal.pageSize.getWidth();
        const margin = 20;
        let yPos = 20;
        docRes.setDrawColor(226, 232, 240);
        docRes.setLineWidth(0.5);
        docRes.line(margin, 10, pageWidth - margin, 10);
        docRes.setFont("helvetica", "bold");
        docRes.setFontSize(18);
        docRes.setTextColor(30, 41, 59);
        docRes.text("Relatório Unificado de Utils", pageWidth / 2, yPos, { align: 'center' });
        yPos += 10;
        const tenant = tenants.find(t => t.id === group.property?.tenantId);
        const tenantName = tenant ? tenant.name : (group.property?.address || 'Unidade Desconhecida');
        const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        let formattedRef = group.month;
        if (group.month.includes('-')) {
            const [y, m] = group.month.split('-');
            formattedRef = `${monthNames[parseInt(m) - 1]} / ${y}`;
        }
        docRes.setFont("helvetica", "normal");
        docRes.setFontSize(12);
        docRes.setTextColor(71, 85, 105);
        docRes.text(tenantName, pageWidth / 2, yPos, { align: 'center' });
        yPos += 7;
        docRes.text(`Referência: ${formattedRef}`, pageWidth / 2, yPos, { align: 'center' });
        yPos += 15;
        if (group.energy.total !== undefined) {
            docRes.setFillColor(240, 249, 255);
            docRes.rect(margin, yPos, pageWidth - (margin * 2), 8, "F");
            docRes.setFont("helvetica", "bold");
            docRes.setFontSize(12);
            docRes.setTextColor(14, 165, 233);
            docRes.text("ENERGIA ELÉTRICA", margin + 5, yPos + 6);
            yPos += 12;
            docRes.setFont("helvetica", "normal"); docRes.setFontSize(10); docRes.setTextColor(50);
            const eLines = [
                `Leitura Anterior: ${group.energy.prevReading ?? '-'}`,
                `Leitura Atual: ${group.energy.reading?.currentReading ?? '-'}`,
                `Consumo: ${group.energy.consumption ?? 0} kWh`,
                `Total Energia: R$ ${group.energy.total?.toFixed(2) ?? '0,00'}`
            ];
            eLines.forEach(line => { docRes.text(line, margin, yPos + 5); yPos += 6; });
            yPos += 10;
        }
        if (group.water.total !== undefined) {
            docRes.setFillColor(236, 253, 245);
            docRes.rect(margin, yPos, pageWidth - (margin * 2), 8, "F");
            docRes.setFont("helvetica", "bold");
            docRes.setFontSize(12);
            docRes.setTextColor(16, 185, 129);
            docRes.text("ÁGUA & ESGOTO", margin + 5, yPos + 6);
            yPos += 12;
            docRes.setFont("helvetica", "normal"); docRes.setFontSize(10); docRes.setTextColor(50);
            const wLines = [
                `Leitura Anterior: ${group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'} m³`,
                `Leitura Atual: ${group.water.reading?.currentReading?.toFixed(3).replace('.', ',') ?? '-'} m³`,
                `Consumo: ${group.water.consumption?.toFixed(3).replace('.', ',') ?? 0} m³`,
                `Total Água: R$ ${group.water.total?.toFixed(2) ?? '0,00'}`
            ];
            wLines.forEach(line => { docRes.text(line, margin, yPos + 5); yPos += 6; });
            yPos += 10;
        }
        yPos += 5;
        docRes.setDrawColor(203, 213, 225);
        docRes.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;
        const finalTotal = (group.energy.total || 0) + (group.water.total || 0);
        docRes.setFontSize(14);
        docRes.setFont("helvetica", "bold");
        docRes.setTextColor(15, 23, 42);
        docRes.text(`TOTAL GERAL: R$ ${finalTotal.toFixed(2).replace('.', ',')}`, pageWidth - margin, yPos, { align: 'right' });
        return { doc: docRes, tenantName };
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
            payments.some(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${group.month}`));

        if (hasAsaasPayment || createdCharges[chargeKey]) {
            showToast('Cobrança já existe! Exclua a antiga se necessário.', 'error');
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
                    const newC = await createCustomer(tenant.name, cpfClean, tenant.email || `sem-email-${cpfClean}@boitto.app`, tenant.phone || '');
                    customerId = newC.id;
                }
                const tenantRef = doc(dbInstance, 'tenants', tenant.id);
                await updateDoc(tenantRef, { asaasCustomerId: customerId });
            }

            const dueDate = calculateDueDate(tenant.dueDay, group.month);
            const dateObj = new Date(dueDate + 'T12:00:00');
            dateObj.setDate(dateObj.getDate() - 1);
            const limitDate = dateObj.toISOString().split('T')[0];

            const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            const [yRef, mRef] = group.month.split('-').map(Number);
            const rentMonth = new Date(yRef, mRef, 1);
            const rentRef = `${monthNames[rentMonth.getMonth()]}/${rentMonth.getFullYear()}`;
            const utilsRef = `${monthNames[mRef - 1]}/${yRef}`;

            const rentVal = property.baseRent || 0;
            const energyVal = group.energy?.total || 0;
            const waterVal = group.water?.total || 0;

            const description = `Unid: ${property.address} - Aluguel (${rentRef}): R$ ${rentVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `Energia: R$ ${energyVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Água: R$ ${waterVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `Total Geral: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

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
                // FALLBACK: Se o customerId estava salvo mas é inválido no Asaas
                if (payErr.message?.includes('invalid_customer')) {
                    const cpfClean = tenant.cpf.replace(/\D/g, '');
                    const retryC = await getCustomerByCpf(cpfClean) ||
                        await createCustomer(tenant.name, cpfClean, tenant.email || `sem-email-${cpfClean}@boitto.app`, tenant.phone || '');
                    customerId = retryC.id;
                    const tenantRef = doc(dbInstance, 'tenants', tenant.id);
                    await updateDoc(tenantRef, { asaasCustomerId: customerId });

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
                showToast('Gerando recibo profissional...', 'info');
                const { doc: docRecibo, tenantName } = await createProfessionalReceiptPDF(group, description, total);
                const pdfBase64 = docRecibo.output('datauristring');
                await uploadPaymentDocument(payment.id, pdfBase64, `Recibo_${tenantName}_${group.month}.pdf`, true);
            } catch (err) { console.error(err); }

            const newC = { ...createdCharges, [chargeKey]: payment.id };
            setCreatedCharges(newC);
            localStorage.setItem('asaas-created-charges', JSON.stringify(newC));
            showToast('Cobrança criada!', 'success');
            if (payment.invoiceUrl) window.open(payment.invoiceUrl, '_blank');
            fetchData();
        } catch (e: any) {
            showToast(e.message || 'Erro ao criar cobrança', 'error');
        } finally {
            setLoadingCharge(null);
        }
    };

    const filteredTransactions = useMemo(() => {
        let filtered = transactions;

        // Filtro por mês - Sempre respeitar o filtro global do topo
        if (filterMonth !== 'ALL') {
            filtered = filtered.filter(t => t.date?.startsWith(filterMonth));
        }

        // Filtro por tipo (Entrada/Saída)
        if (transTypeFilter === 'IN') {
            filtered = filtered.filter(t => (t.value || 0) > 0);
        } else if (transTypeFilter === 'OUT') {
            filtered = filtered.filter(t => (t.value || 0) < 0);
        }

        // Se estiver filtrando por uma cobrança específica (item clicado na lista lateral)
        if (extratoFilter) {
            const nameTerm = extratoFilter.name.toLowerCase();
            const nameParts = nameTerm.split(' ').filter(p => p.length > 2);
            const idTerm = extratoFilter.id.toLowerCase();

            filtered = filtered.filter(t => {
                const desc = (t.description || '').toLowerCase();
                const paymentId = (t.paymentId || '').toLowerCase();

                // Match por ID 
                const idMatch = paymentId === idTerm || desc.includes(idTerm);

                // Match por nome
                const nameMatch = nameParts.length > 0 && nameParts.some(part => desc.includes(part));

                return idMatch || nameMatch;
            });
        }

        return filtered;
    }, [transactions, filterMonth, extratoFilter, transTypeFilter]);

    const modalTransactions = useMemo(() => {
        if (!selectedPaymentForDetail) return [];

        let filtered = transactions;

        if (filterMonth !== 'ALL') {
            filtered = filtered.filter(t => t.date?.startsWith(filterMonth));
        }

        const tenant = tenants.find(t => t.asaasCustomerId === selectedPaymentForDetail.customer);
        const displayName = tenant?.name || selectedPaymentForDetail.customerName || '';
        const nameTerm = displayName.toLowerCase();
        const nameParts = nameTerm.split(' ').filter(p => p.length > 2);
        const idTerm = selectedPaymentForDetail.id.toLowerCase();

        filtered = filtered.filter(t => {
            const desc = (t.description || '').toLowerCase();
            const paymentId = (t.paymentId || '').toLowerCase();

            const idMatch = paymentId === idTerm || desc.includes(idTerm);
            const nameMatch = nameParts.length > 0 && nameParts.some(part => desc.includes(part));

            return idMatch || nameMatch;
        });

        return filtered;
    }, [transactions, filterMonth, selectedPaymentForDetail, tenants]);

    const filteredPayments = useMemo(() => {
        let filtered = payments;
        if (filterStatus !== 'ALL') {
            if (filterStatus === 'RECEIVED') {
                filtered = filtered.filter(p => p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH');
            } else {
                filtered = filtered.filter(p => p.status === filterStatus);
            }
        }
        if (filterMonth !== 'ALL') {
            filtered = filtered.filter(p => {
                const dueDateMatch = p.dueDate?.startsWith(filterMonth);
                const paymentDateMatch = p.paymentDate?.startsWith(filterMonth);
                const clientPaymentDateMatch = p.clientPaymentDate?.startsWith(filterMonth);
                return dueDateMatch || paymentDateMatch || clientPaymentDateMatch;
            });
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
                return { bg: 'bg-emerald-500/10', text: 'text-emerald-500', icon: <CheckCircle2 size={12} />, label: 'Recebido' };
            case 'PENDING':
                return { bg: 'bg-amber-500/10', text: 'text-amber-500', icon: <Clock size={12} />, label: 'Pendente' };
            case 'OVERDUE':
                return { bg: 'bg-rose-500/10', text: 'text-rose-500', icon: <AlertCircle size={12} />, label: 'Vencido' };
            case 'CONFIRMED':
                return { bg: 'bg-blue-500/10', text: 'text-blue-500', icon: <CreditCard size={12} />, label: 'Confirmado' };
            default:
                return { bg: 'bg-slate-500/10', text: 'text-slate-500', icon: <Info size={12} />, label: status };
        }
    };

    const handleDeletePayment = async (paymentId: string, displayName: string) => {
        if (!window.confirm(`Deseja realmente excluir a cobrança de ${displayName}?`)) return;

        try {
            await deletePayment(paymentId);
            showToast('Cobrança excluída com sucesso!', 'success');
            fetchData();
        } catch (error: any) {
            console.error('Erro ao excluir cobrança:', error);
            showToast('Erro ao excluir cobrança.', 'error');
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
        <div className="animate-fade-in bg-slate-50 min-h-screen -mx-4 -mt-6 px-6 pt-4 pb-12 uppercase">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Top Bar - Dashboard Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Balance Card */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between min-h-[96px]">
                    <div className="flex justify-between items-center mb-0.5">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-tight">Saldo em conta</p>
                        <button
                            onClick={() => setShowTransactionsModal(true)}
                            className="px-2 py-1 border border-slate-900 rounded-lg text-[9px] font-black text-slate-900 hover:bg-slate-900 hover:text-white transition-all uppercase tracking-widest flex items-center gap-1.5"
                        >
                            <FileText size={10} />
                            Extrato
                        </button>
                    </div>
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-black text-slate-800">
                            {showBalance ? (balance !== null ? formatCurrency(balance) : 'R$ ---') : '••••••••'}
                        </h2>
                        <button
                            onClick={() => setShowBalance(!showBalance)}
                            className="text-slate-400 hover:text-blue-600 p-2 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                            {showBalance ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                {/* Pix Card */}
                <div
                    onClick={handleFetchPixKeys}
                    className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between min-h-[96px] cursor-pointer hover:border-emerald-500 hover:shadow-md transition-all group lg:col-span-1"
                >
                    <div className="flex justify-between items-center">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-tight mb-0.5 group-hover:text-emerald-600 transition-colors">Transferir agora</p>
                        <ArrowUpRight size={14} className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 font-black shrink-0" />
                    </div>
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-black text-slate-800 italic tracking-tighter">PIX</h2>
                        <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center font-black italic text-[11px] text-white shadow-sm shadow-emerald-500/20 group-hover:scale-110 transition-transform">pix</div>
                    </div>
                </div>

                {/* Header section with Glassmorphism (Replaced Filter Card) */}
                <section className="relative group col-span-1 sm:col-span-2 lg:col-span-2">
                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
                    <div className="relative h-full bg-white/60 backdrop-blur-3xl border border-white/40 p-3 rounded-2xl shadow-sm flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-600 rounded flex items-center justify-center text-white">
                                    <Wallet size={12} />
                                </div>
                                <div>
                                    <h2 className="text-[11px] font-black text-slate-900 tracking-tight leading-none">CASA</h2>
                                    <p className="text-[7px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Asaas Dashboard</p>
                                </div>
                            </div>

                            <button
                                onClick={async () => {
                                    const success = await requestNotificationPermission();
                                    if (success) {
                                        setNotificationsEnabled(true);
                                        showToast("Notificações ativadas com sucesso!", "success");
                                    }
                                }}
                                className={`p-1.5 rounded-lg transition-all border ${notificationsEnabled
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                    : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                                {notificationsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                                <select
                                    className="w-full bg-white/80 border border-slate-200/50 rounded-lg pl-8 pr-2 py-1.5 font-black text-slate-700 text-[10px] appearance-none cursor-pointer focus:ring-2 focus:ring-emerald-500/10 transition-all uppercase"
                                    value={filterMonth}
                                    onChange={(e) => setFilterMonth(e.target.value)}
                                >
                                    <option value="ALL">TODAS</option>
                                    {availableMonths.map(m => (
                                        <option key={m} value={m}>{formatReferenceMonth(m).toUpperCase()}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={fetchData}
                                disabled={loading}
                                className="p-2 bg-slate-900 text-white rounded-lg shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                            >
                                <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        <div className="flex bg-slate-100/50 p-1 rounded-xl mt-2 w-full">
                            <button
                                onClick={() => setActiveTab('dashboard')}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest ${activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm shadow-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Dashboard
                            </button>
                            <button
                                onClick={() => setActiveTab('prep')}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest ${activeTab === 'prep' ? 'bg-white text-slate-900 shadow-sm shadow-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Preparação
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            <div className="max-w-7xl mx-auto space-y-6">
                {activeTab === 'dashboard' ? (
                    <>
                        {/* Dashboard Stats Cards avec Rich Aesthetics (Replaced Situation Section) */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            {(Object.entries(stats) as [keyof typeof stats, any][]).map(([status, s]) => (
                                <button
                                    key={status}
                                    onClick={() => {
                                        setFilterStatus(status);
                                        setShowPaymentsModal(true);
                                    }}
                                    className={`p-2 rounded-2xl transition-all text-left relative overflow-hidden group/card shadow-sm border ${filterStatus === status
                                        ? 'ring-2 ring-emerald-500/20 border-emerald-500 bg-emerald-50/10'
                                        : 'bg-white border-slate-100 hover:border-emerald-500 hover:shadow-md'
                                        }`}
                                >
                                    <div className={`absolute -right-2 -bottom-2 w-16 h-16 bg-gradient-to-br ${s.gradient} opacity-[0.03] rounded-full group-hover/card:scale-125 transition-transform duration-700`}></div>

                                    <div className="flex items-center justify-between mb-1 relative">
                                        <div className={`w-7 h-7 bg-gradient-to-br ${s.gradient} text-white rounded-lg flex items-center justify-center shadow-lg transition-transform`}>
                                            {React.cloneElement(s.icon as React.ReactElement, { size: 12 })}
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-sm font-black text-slate-900 italic">{s.count}</span>
                                            <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{s.label}</span>
                                        </div>
                                    </div>

                                    <div className="relative flex flex-col gap-0.5 mt-2">
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest opacity-60">Total:</span>
                                            <p className="text-sm font-black text-slate-900 tracking-tight">
                                                <span className="text-[8px] font-bold text-slate-400 mr-0.5">R$</span>
                                                {s.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-60">
                                            <User size={8} className="text-slate-400" />
                                            <span className="text-[7px] font-bold text-slate-400 uppercase">{s.clients} CLIENTES</span>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                    </>
                ) : (
                    /* Prep Tab - Identical to AsaasTab */
                    <div className="space-y-4">
                        {/* Desktop View (Table) */}
                        <div className="hidden md:block overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50/50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Inquilino / Unidade</th>
                                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Consumos</th>
                                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Aluguel</th>
                                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">TOTAL</th>
                                        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Ações</th>
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
                                            const existingPayment = tenant ? (
                                                nextMonthPayments.find(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`)) ||
                                                payments.find(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`))
                                            ) : null;
                                            const isCharged = !!existingPayment || (chargeKey && createdCharges[chargeKey]);
                                            const paymentId = existingPayment?.id || (chargeKey ? createdCharges[chargeKey] : null);
                                            const paymentStatus = existingPayment?.status || (paymentId ? payments.find(p => p.id === paymentId)?.status : null);
                                            const canDelete = paymentId && (paymentStatus === 'PENDING' || paymentStatus === 'OVERDUE');

                                            const isLoading = loadingCharge === tenant?.id;
                                            const grossTotal = (data.grandTotal || 0) + (data.property?.baseRent || 0);
                                            return (
                                                <tr key={idx} className="group hover:bg-emerald-50/60 transition-all duration-300">
                                                    <td className="px-4 py-3">
                                                        <div className="font-black text-slate-900 leading-tight text-base tracking-tight">{tenant?.name || 'Vazio'}</div>
                                                        <div className="text-[9px] text-slate-400 mt-1 uppercase font-black tracking-widest leading-none truncate max-w-[200px]">{data.property?.address}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col gap-1 items-center">
                                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 font-black text-[9px] w-full max-w-[140px]">
                                                                <Droplets size={10} />
                                                                Água: R$ {data.water.total?.toFixed(2).replace('.', ',') || '0,00'}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 font-black text-[9px] w-full max-w-[140px]">
                                                                <Zap size={10} />
                                                                Energia: R$ {data.energy.total?.toFixed(2).replace('.', ',') || '0,00'}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center font-black text-slate-700 text-sm whitespace-nowrap italic">R$ {data.property?.baseRent?.toFixed(2).replace('.', ',') || '0,00'}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5 opacity-60 italic">TOTAL</div>
                                                        <div className="flex items-center justify-center gap-2">
                                                            <span className="font-black text-slate-900 text-lg tracking-tighter whitespace-nowrap italic">R$ {grossTotal.toFixed(2).replace('.', ',')}</span>
                                                            {canDelete && (
                                                                <button
                                                                    onClick={() => handleDeletePayment(paymentId, tenant?.name || '')}
                                                                    className="text-rose-500 hover:text-rose-700 transition-colors p-1 hover:bg-rose-50 rounded"
                                                                    title="Excluir Cobrança"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex flex-row items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => handleCharge(data)}
                                                                disabled={!tenant || isLoading || !!isCharged}
                                                                className={`h-9 px-4 rounded-xl transition-all font-black text-[10px] shadow-lg flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${isCharged
                                                                    ? 'bg-blue-500 text-white shadow-blue-500/30'
                                                                    : 'bg-slate-900 text-white shadow-slate-900/40 hover:scale-105 active:scale-95 shadow-lg'
                                                                    }`}
                                                            >
                                                                {isLoading ? <RefreshCcw size={14} className="animate-spin" /> : isCharged ? <CheckCircle2 size={14} /> : <DollarSign size={14} />}
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
                                    const existingPayment = tenant ? (
                                        nextMonthPayments.find(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`)) ||
                                        payments.find(p => p.customer === tenant.asaasCustomerId && p.description?.includes(`Ref: ${data.month}`))
                                    ) : null;
                                    const isCharged = !!existingPayment || (chargeKey && createdCharges[chargeKey]);
                                    const paymentId = existingPayment?.id || (chargeKey ? createdCharges[chargeKey] : null);
                                    const paymentStatus = existingPayment?.status || (paymentId ? payments.find(p => p.id === paymentId)?.status : null);
                                    const canDelete = paymentId && (paymentStatus === 'PENDING' || paymentStatus === 'OVERDUE');

                                    const isLoading = loadingCharge === tenant?.id;
                                    const grossTotal = (data.grandTotal || 0) + (data.property?.baseRent || 0);

                                    return (
                                        <div key={idx} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-4">
                                            <div className="mb-4">
                                                <div className="font-black text-slate-900 text-lg leading-tight uppercase tracking-tighter italic">{tenant?.name || 'Vazio'}</div>
                                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{data.property?.address}</div>
                                            </div>

                                            <div className="space-y-2 mb-4">
                                                <div className="flex justify-between items-center text-xs">
                                                    <div className="text-slate-500 font-bold uppercase tracking-widest text-[9px]">Consumos</div>
                                                    <div className="flex gap-1">
                                                        <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 font-black text-[9px]">💧 R$ {data.water.total?.toFixed(2).replace('.', ',') || '0,00'}</span>
                                                        <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-600 font-black text-[9px]">⚡ R$ {data.energy.total?.toFixed(2).replace('.', ',') || '0,00'}</span>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <div className="text-slate-500 font-bold uppercase tracking-widest text-[9px]">Aluguel</div>
                                                    <div className="font-black text-slate-700 italic">R$ {data.property?.baseRent?.toFixed(2).replace('.', ',') || '0,00'}</div>
                                                </div>
                                                <div className="pt-2 border-t border-slate-50 flex justify-between items-center">
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TOTAL GERAL</div>
                                                    <div className="flex items-center gap-2">
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeletePayment(paymentId, tenant?.name || '')}
                                                                className="text-rose-500 p-1.5 bg-rose-50 rounded-lg"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                        <div className="text-xl font-black text-slate-900 tracking-tighter italic">
                                                            <span className="text-[10px] text-slate-400 font-bold mr-0.5">R$</span>
                                                            {grossTotal.toFixed(2).replace('.', ',')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleCharge(data)}
                                                    disabled={!tenant || isLoading || !!isCharged}
                                                    className={`flex-1 py-3.5 rounded-2xl transition-all font-black text-[11px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isCharged
                                                        ? 'bg-blue-500 text-white shadow-blue-500/30'
                                                        : 'bg-slate-900 text-white shadow-slate-900/40 active:scale-95'
                                                        }`}
                                                >
                                                    {isLoading ? <RefreshCcw size={16} className="animate-spin" /> : isCharged ? <CheckCircle2 size={16} /> : <DollarSign size={16} />}
                                                    {isCharged ? 'Criada' : 'Gerar Cobrança'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200">
                                    <Zap size={32} className="mx-auto text-slate-200 mb-2" />
                                    <p className="text-slate-400 font-bold uppercase tracking-widest">Nenhuma unidade encontrada.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>




            {/* Modal 1: Lista de Cobranças */}
            {showPaymentsModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-start justify-center p-4 pt-4 sm:pt-10 animate-fade-in uppercase overflow-y-auto"
                    onClick={() => setShowPaymentsModal(false)}
                >
                    <div
                        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-scale-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-slate-900 px-6 py-4 flex justify-between items-center text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                                    <Filter className="text-white" size={18} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black italic">Cobranças</h3>
                                    <p className="text-[9px] text-blue-400 font-black uppercase tracking-[0.2em]">
                                        {getStatusStyle(filterStatus).label} • {filterMonth === 'ALL' ? 'Todo o período' : formatReferenceMonth(filterMonth)}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPaymentsModal(false)}
                                className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-2xl flex items-center justify-center transition-all group"
                            >
                                <ArrowRight className="rotate-45 text-white/50 group-hover:text-white" size={20} />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                                {filteredPayments.length === 0 ? (
                                    <div className="py-16 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                        <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest">Nenhuma cobrança nesta situação</p>
                                    </div>
                                ) : (
                                    filteredPayments.map((p) => {
                                        const style = getStatusStyle(p.status);
                                        const tenant = tenants.find(t => t.asaasCustomerId === p.customer);
                                        const displayName = tenant?.name || p.customerName || p.customer || 'Sem nome';
                                        return (
                                            <div
                                                key={p.id}
                                                onClick={() => {
                                                    handleOpenPaymentDetail(p);
                                                }}
                                                className="p-4 rounded-2xl border border-slate-100 hover:border-emerald-500/30 hover:bg-emerald-50/40 transition-all group cursor-pointer active:scale-[0.98]"
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-slate-400 text-[9px] font-black uppercase tracking-tight">
                                                        {p.paymentDate || p.clientPaymentDate
                                                            ? `Pago em: ${new Date(p.paymentDate || p.clientPaymentDate).toLocaleDateString('pt-BR')}`
                                                            : `Vence: ${new Date(p.dueDate).toLocaleDateString('pt-BR')}`}
                                                    </span>
                                                    <div className={`px-2.5 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wider ${style.bg} ${style.text}`}>
                                                        {style.label}
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <p className="font-black text-slate-900 text-sm mb-0 group-hover:text-emerald-700 transition-colors uppercase tracking-tight">{displayName}</p>
                                                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{p.id}</p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {(p.status === 'PENDING' || p.status === 'OVERDUE') && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeletePayment(p.id, displayName);
                                                                }}
                                                                className="w-8 h-8 flex items-center justify-center text-rose-500 bg-rose-50 hover:bg-rose-100 rounded-lg transition-all"
                                                                title="Excluir Cobrança"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                        <div className="text-right">
                                                            <p className="text-slate-900 font-black text-lg leading-none mb-0.5">{formatCurrency(p.netValue || p.value)}</p>
                                                            <div className="text-slate-400 text-[9px] font-black uppercase tracking-wider opacity-60">
                                                                Bruto: {formatCurrency(p.value)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <button
                                onClick={() => setShowPaymentsModal(false)}
                                className="w-full bg-slate-100 text-slate-500 py-3.5 rounded-2xl font-black text-[10px] hover:bg-slate-200 transition-all uppercase tracking-widest mt-6"
                            >
                                Fechar Lista
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {/* Pix Modal */}
            {showPixModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-4 sm:pt-10 animate-fade-in uppercase overflow-y-auto">
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
                                                        setManualPixKey(key.isGuessed ? key.key : '');
                                                        setPixStep('AMOUNT');
                                                    }}
                                                    className="w-full p-4 bg-white border border-slate-100 rounded-2xl flex items-center gap-4 group hover:border-emerald-500 hover:shadow-md transition-all text-left"
                                                >
                                                    <div className={`w-12 h-12 rounded-2xl ${getBankBrand(key.bankName, key.bankCode).color} flex items-center justify-center shrink-0 overflow-hidden shadow-inner`}>
                                                        {getBankBrand(key.bankName, key.bankCode).domain ? (
                                                            <img
                                                                src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(key.bankName, key.bankCode).domain}`}
                                                                alt={key.bankName}
                                                                className="w-8 h-8 object-contain"
                                                                onError={(e) => {
                                                                    (e.target as any).style.display = 'none';
                                                                    (e.target as any).parentElement.innerText = getBankBrand(key.bankName, key.bankCode).initials;
                                                                }}
                                                            />
                                                        ) : (
                                                            <span className="text-white font-black text-xs">{getBankBrand(key.bankName, key.bankCode).initials}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="text-[11px] font-black text-emerald-600 uppercase tracking-tight group-hover:text-emerald-700 truncate">{key.bankName}</h4>
                                                        <p className="text-[12px] font-black text-slate-800 truncate">{key.ownerName}</p>
                                                    </div>
                                                    <ArrowRight className="text-slate-200 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" size={16} />
                                                </button>
                                            ))
                                        )}
                                    </div>

                                    <button
                                        onClick={() => setShowPixModal(false)}
                                        className="w-full bg-slate-900/5 text-slate-400 py-4 rounded-2xl font-black text-xs hover:bg-slate-900/10 transition-all uppercase tracking-widest mt-4"
                                    >
                                        Cancelar
                                    </button>
                                </>
                            )}

                            {pixStep !== 'SELECT' && (
                                <>
                                    {pixStep === 'AMOUNT' && (
                                        <div className="space-y-6">
                                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-xl ${getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).color} flex items-center justify-center overflow-hidden`}>
                                                    {getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).domain ? (
                                                        <img
                                                            src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).domain}`}
                                                            className="w-8 h-8 object-contain grayscale brightness-200"
                                                            alt=""
                                                        />
                                                    ) : (
                                                        <span className="text-white font-black text-xs">{getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).initials}</span>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Para: {selectedPixKey?.bankName}</p>
                                                    <p className="text-sm font-black text-slate-800 truncate">{selectedPixKey?.ownerName}</p>
                                                </div>
                                            </div>
                                            {/* Campo para chave Pix quando não temos a chave salva ou ela é apenas uma adivinhação */}
                                            {selectedPixKey && (!selectedPixKey.hasRealPixKey || selectedPixKey.isGuessed) && (
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
                                                        {selectedPixKey.isGuessed ? 'Confirmar ou Alterar Chave Pix' : 'Chave Pix desta conta'}
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={manualPixKey}
                                                        onChange={(e) => setManualPixKey(e.target.value)}
                                                        placeholder="CPF, e-mail, celular ou chave aleatória"
                                                        className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 focus:ring-0 rounded-2xl py-3 px-4 text-sm font-bold text-slate-800 transition-all"
                                                    />
                                                    <p className="text-[8px] text-slate-400 mt-1 font-bold">
                                                        A chave será salva para transferências futuras.
                                                    </p>
                                                </div>
                                            )}

                                            {/* Mostra a chave Pix salva quando disponível e NÃO for uma adivinhação */}
                                            {selectedPixKey?.hasRealPixKey && !selectedPixKey.isGuessed && selectedPixKey?.key && (
                                                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                                                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Chave Pix</p>
                                                    <p className="text-xs font-bold text-emerald-800 truncate">{formatPixKeyDisplay(selectedPixKey.key, selectedPixKey.pixKeyType)}</p>
                                                </div>
                                            )}

                                            <div className="relative">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xl">R$</div>
                                                <input
                                                    type="number"
                                                    autoFocus={!!selectedPixKey?.hasRealPixKey}
                                                    value={transferAmount}
                                                    onChange={(e) => setTransferAmount(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && transferAmount && parseFloat(transferAmount) > 0 && (balance === null || parseFloat(transferAmount) <= balance)) {
                                                            setPixStep('CONFIRM');
                                                        }
                                                    }}
                                                    placeholder="0,00"
                                                    className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 focus:ring-0 rounded-2xl py-6 pl-12 pr-6 text-3xl font-black text-slate-800 transition-all text-center"
                                                />
                                            </div>

                                            <button
                                                disabled={!transferAmount || parseFloat(transferAmount) <= 0 || (balance !== null && parseFloat(transferAmount) > balance) || (!selectedPixKey?.hasRealPixKey && !manualPixKey.trim())}
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
                                                    <div className={`w-10 h-10 rounded-xl ${getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).color} flex items-center justify-center overflow-hidden`}>
                                                        {getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).domain ? (
                                                            <img
                                                                src={`https://www.google.com/s2/favicons?sz=64&domain=${getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).domain}`}
                                                                className="w-6 h-6 object-contain grayscale brightness-200"
                                                                alt=""
                                                            />
                                                        ) : (
                                                            <span className="text-white font-black text-xs">{getBankBrand(selectedPixKey?.bankName, selectedPixKey?.bankCode).initials}</span>
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
                                                        <span className="text-[9px] font-bold text-white/40 uppercase">Chave Pix</span>
                                                        <span className="text-[11px] font-black">
                                                            {manualPixKey || selectedPixKey?.key}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                disabled={isTransferring}
                                                onClick={handleTransferConfirm}
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
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Fluxo de Detalhes da Cobrança (Modal Pop-up) */}
            {showDetailModal && selectedPaymentForDetail && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-start justify-center p-4 pt-4 sm:pt-10 animate-fade-in uppercase overflow-y-auto"
                    onClick={() => setShowDetailModal(false)}
                >
                    <div
                        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-scale-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="bg-slate-900 px-6 py-4 flex justify-between items-center text-white">
                            <div>
                                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-0.5">Extrato Detalhado</p>
                                <h3 className="text-lg font-black italic">Cobrança {selectedPaymentForDetail.id.slice(-6)}</h3>
                            </div>
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-all group"
                            >
                                <ArrowRight className="rotate-45 text-white/50 group-hover:text-white" size={18} />
                            </button>
                        </div>

                        <div className="p-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                            <div className="space-y-6">
                                {/* Resumo Principal */}
                                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Inquilino</p>
                                            <h4 className="text-base font-black text-slate-900 leading-tight">
                                                {tenants.find(t => t.asaasCustomerId === selectedPaymentForDetail.customer)?.name || selectedPaymentForDetail.customerName || 'Inquilino não identificado'}
                                            </h4>
                                        </div>
                                        <div className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${getStatusStyle(selectedPaymentForDetail.status).bg} ${getStatusStyle(selectedPaymentForDetail.status).text}`}>
                                            {getStatusStyle(selectedPaymentForDetail.status).label}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                            <p className="text-[8px] font-black text-slate-400 uppercase mb-0.5">Valor Bruto</p>
                                            <p className="text-lg font-black text-slate-900">{formatCurrency(selectedPaymentForDetail.value)}</p>
                                        </div>
                                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                            <p className="text-[8px] font-black text-slate-400 uppercase mb-0.5">Valor Líquido</p>
                                            <p className="text-lg font-black text-emerald-600">{formatCurrency(selectedPaymentForDetail.netValue || selectedPaymentForDetail.value)}</p>
                                        </div>
                                    </div>
                                </div>


                                {/* Histórico de Eventos, Transações e Notificações Unificados */}
                                <div>
                                    <h5 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <Clock size={13} className="text-slate-400" />
                                        Linha do Tempo
                                    </h5>
                                    <div className="flex flex-col border border-slate-100 rounded-2xl overflow-hidden">
                                        {/* Table Header - Hidden on Mobile */}
                                        <div className="hidden sm:grid grid-cols-[80px_1fr_90px] gap-2 px-3 py-2 border-b border-slate-100 text-[8px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 shrink-0">
                                            <div>Data</div>
                                            <div>Transação</div>
                                            <div className="text-right">Valor</div>
                                        </div>

                                        <div className="space-y-2 sm:space-y-0 overflow-y-auto pr-1 custom-scrollbar py-1 sm:py-0 max-h-[300px]">
                                            {modalTransactions.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center py-10 space-y-2.5">
                                                    <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center">
                                                        <Info size={18} className="text-slate-300" />
                                                    </div>
                                                    <p className="text-center text-slate-400 text-[9px] font-bold uppercase tracking-widest">Nenhum evento registrado</p>
                                                </div>
                                            ) : (
                                                modalTransactions.map((t, idx) => {
                                                    let displayDesc = t.description || 'Transação Asaas';
                                                    let customerName = '';

                                                    // Expressão Regular para pegar "Descrição" + "da cobrança ID" ou "- fatura nr. ID" + "Nome do Cliente"
                                                    const matchDetails = displayDesc.match(/(.*?)(?:\s+da cobrança\s+|\s+-\s+fatura nr\.\s+)([A-Z0-9_]+)\s+(.*)/i);

                                                    if (matchDetails) {
                                                        displayDesc = matchDetails[1].trim();
                                                        customerName = matchDetails[3].trim();
                                                    } else if (displayDesc.toLowerCase().includes('transação via pix com chave para')) {
                                                        const parts = displayDesc.split(' para ');
                                                        if (parts.length > 1) {
                                                            displayDesc = 'Transação Pix Enviada';
                                                            customerName = parts.slice(1).join(' para ');
                                                        }
                                                    }

                                                    const displayValue = t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                                                    return (
                                                        <div key={t.id || idx} className="group relative flex flex-col sm:grid sm:grid-cols-[80px_1fr_90px] gap-1 sm:gap-2 px-4 py-2.5 sm:px-3 sm:py-2 rounded-2xl sm:rounded-none border-b sm:border-slate-50 hover:bg-emerald-50/40 transition-all mb-1 sm:mb-0 items-center">
                                                            {/* Desktop Only Data Column */}
                                                            <div className="hidden sm:block text-[10px] text-slate-400 font-medium">
                                                                {new Date(t.date).toLocaleDateString('pt-BR')}
                                                            </div>

                                                            {/* Mobile Header: Date and Value */}
                                                            <div className="flex sm:hidden justify-between items-center mb-1.5">
                                                                <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-widest">
                                                                    {new Date(t.date).toLocaleDateString('pt-BR')}
                                                                </span>
                                                                <div className={`font-black text-[13px] ${t.value < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                    {t.value < 0 && !displayValue.startsWith('-') ? `-${displayValue}` : displayValue}
                                                                </div>
                                                            </div>

                                                            {/* Transaction Details */}
                                                            <div className="min-w-0">
                                                                <p className="font-black text-slate-800 text-[11px] sm:text-[10px] truncate leading-tight uppercase tracking-tight">{displayDesc}</p>
                                                            </div>

                                                            {/* Desktop Only Value Column */}
                                                            <div className={`hidden sm:block font-black text-[10px] text-right ${t.value < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                {t.value < 0 && !displayValue.startsWith('-') ? `-${displayValue}` : displayValue}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-100">
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="w-full bg-slate-900 text-white py-3.5 rounded-2xl font-black text-[10px] hover:bg-slate-800 transition-all uppercase tracking-widest"
                            >
                                Fechar Detalhes
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal 3: Extrato Completo */}
            {showTransactionsModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[130] flex items-start justify-center p-4 pt-4 sm:pt-10 animate-fade-in uppercase overflow-y-auto"
                    onClick={() => setShowTransactionsModal(false)}
                >
                    <div
                        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl overflow-hidden transform transition-all animate-scale-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="bg-slate-900 px-6 py-4 flex justify-between items-center text-white">
                            <div>
                                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-0.5">Visão Geral</p>
                                <h3 className="text-lg font-black italic">Extrato de Movimentações</h3>
                            </div>
                            <button
                                onClick={() => setShowTransactionsModal(false)}
                                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-all group"
                            >
                                <ArrowRight className="rotate-45 text-white/50 group-hover:text-white" size={18} />
                            </button>
                        </div>

                        {/* Filtros e Resumo */}
                        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                                    <select
                                        value={filterMonth}
                                        onChange={(e) => setFilterMonth(e.target.value)}
                                        className="bg-transparent text-[11px] font-black uppercase appearance-none focus:outline-none cursor-pointer text-slate-700 pr-4"
                                    >
                                        {availableMonths.map(m => (
                                            <option key={m} value={m}>
                                                {formatReferenceMonth(m).toUpperCase()}
                                            </option>
                                        ))}
                                    </select>
                                    <Calendar size={14} className="text-slate-400" />
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setTransTypeFilter(transTypeFilter === 'IN' ? 'ALL' : 'IN')}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${transTypeFilter === 'IN' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200 hover:border-emerald-300'}`}
                                    >
                                        <div className={`w-3 h-3 rounded flex items-center justify-center border ${transTypeFilter === 'IN' ? 'bg-white border-transparent' : 'border-slate-200'}`}>
                                            {transTypeFilter === 'IN' && <CheckCircle2 size={8} className="text-emerald-600" />}
                                        </div>
                                        Entradas
                                    </button>
                                    <button
                                        onClick={() => setTransTypeFilter(transTypeFilter === 'OUT' ? 'ALL' : 'OUT')}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${transTypeFilter === 'OUT' ? 'bg-rose-600 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200 hover:border-rose-300'}`}
                                    >
                                        <div className={`w-3 h-3 rounded flex items-center justify-center border ${transTypeFilter === 'OUT' ? 'bg-white border-transparent' : 'border-slate-200'}`}>
                                            {transTypeFilter === 'OUT' && <CheckCircle2 size={8} className="text-rose-600" />}
                                        </div>
                                        Saídas
                                    </button>
                                </div>
                            </div>

                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white border border-slate-200 px-3 py-1.5 rounded-lg">
                                {filteredTransactions.length} Lançamentos
                            </div>
                        </div>

                        {/* Tabela de Resultados */}
                        <div className="flex-1 overflow-hidden flex flex-col min-h-[400px]">
                            {/* Table Header */}
                            <div className="hidden sm:grid grid-cols-[100px_1fr_1fr_100px_110px] gap-2 px-6 py-3 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/30 shrink-0">
                                <div>Data</div>
                                <div>Transação</div>
                                <div>Nome/Destino</div>
                                <div className="text-right">Valor</div>
                                <div className="text-right">Saldo</div>
                            </div>

                            <div className="overflow-y-auto max-h-[60vh] custom-scrollbar p-1">
                                {filteredTransactions.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 space-y-3">
                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                                            <Info size={24} className="text-slate-200" />
                                        </div>
                                        <p className="text-center text-slate-400 text-[11px] font-bold uppercase tracking-widest">Nenhuma movimentação encontrada para os filtros selecionados.</p>
                                    </div>
                                ) : (
                                    filteredTransactions.map((t, idx) => {
                                        let displayDesc = t.description || 'Transação Asaas';
                                        let customerName = '';
                                        const matchDetails = displayDesc.match(/(.*?)(?:\s+da cobrança\s+|\s+-\s+fatura nr\.\s+)([A-Z0-9_]+)\s+(.*)/i);

                                        if (matchDetails) {
                                            displayDesc = matchDetails[1].trim();
                                            customerName = matchDetails[3].trim();
                                        } else if (displayDesc.toLowerCase().includes('transação via pix com chave para')) {
                                            const parts = displayDesc.split(' para ');
                                            if (parts.length > 1) {
                                                displayDesc = 'Transação Pix Enviada';
                                                customerName = parts.slice(1).join(' para ');
                                            }
                                        }

                                        const displayValue = t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                                        return (
                                            <div key={t.id || idx} className="group relative flex flex-col sm:grid sm:grid-cols-[100px_1fr_1fr_100px_110px] gap-1 sm:gap-2 px-6 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-all items-center">
                                                <div className="hidden sm:block text-[10px] text-slate-400 font-medium">
                                                    {new Date(t.date).toLocaleDateString('pt-BR')}
                                                </div>
                                                <div className="flex sm:hidden justify-between w-full mb-1">
                                                    <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">{new Date(t.date).toLocaleDateString('pt-BR')}</span>
                                                    <span className={`font-black text-[12px] ${t.value < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                        {t.value < 0 && !displayValue.startsWith('-') ? `-${displayValue}` : displayValue}
                                                    </span>
                                                </div>
                                                <div className="w-full sm:w-auto">
                                                    <p className="font-black text-slate-800 text-[11px] sm:text-[10px] truncate leading-tight uppercase tracking-tight">{displayDesc}</p>
                                                </div>
                                                <div className="w-full sm:w-auto">
                                                    <p className="text-[10px] text-slate-500 font-bold truncate uppercase tracking-tighter">
                                                        {customerName || '-'}
                                                    </p>
                                                </div>
                                                <div className={`hidden sm:block font-black text-[10px] text-right ${t.value < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                    {t.value < 0 && !displayValue.startsWith('-') ? `-${displayValue}` : displayValue}
                                                </div>
                                                <div className="w-full sm:w-auto sm:text-right font-black text-[10px] text-slate-400 sm:text-slate-500">
                                                    <span className="sm:hidden opacity-40 italic mr-1">Saldo:</span>
                                                    {t.balance?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-100">
                            <button
                                onClick={() => setShowTransactionsModal(false)}
                                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] hover:bg-slate-800 transition-all uppercase tracking-widest shadow-xl shadow-slate-900/10"
                            >
                                Fechar Extrato
                            </button>
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
    );
};
