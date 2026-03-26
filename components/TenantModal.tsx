
import React from 'react';
import { Property, Tenant } from '../types';

interface TenantModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    newTenant: any;
    setNewTenant: (tenant: any) => void;
    isSaving: boolean;
    editingId: string | null;
    properties: Property[];
    formatCPF: (v: string) => string;
}

export const TenantModal: React.FC<TenantModalProps> = ({
    isOpen, onClose, onSave, newTenant, setNewTenant, isSaving, editingId, properties, formatCPF
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
                <div className="bg-slate-900 px-6 py-4 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">{editingId ? 'Editar Inquilino' : 'Novo Inquilino'}</h3>
                    <button
                        onClick={onClose}
                        className="text-white/70 hover:text-white text-2xl leading-none"
                    >×</button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome Completo</label>
                            <input
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all font-medium"
                                value={newTenant.name}
                                onChange={e => setNewTenant({ ...newTenant, name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CPF</label>
                                <input
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all font-mono text-sm"
                                    value={newTenant.cpf}
                                    maxLength={14}
                                    onChange={e => setNewTenant({ ...newTenant, cpf: formatCPF(e.target.value) })}
                                    placeholder="000.000.000-00"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone</label>
                                <input
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                                    value={newTenant.phone}
                                    onChange={e => setNewTenant({ ...newTenant, phone: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data de Entrada</label>
                                <input
                                    type="date"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                                    value={newTenant.entryDate}
                                    onChange={e => setNewTenant({ ...newTenant, entryDate: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data de Saída</label>
                                <input
                                    type="date"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                                    value={newTenant.exitDate}
                                    onChange={e => setNewTenant({ ...newTenant, exitDate: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                            <input
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                                value={newTenant.email}
                                onChange={e => setNewTenant({ ...newTenant, email: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dia do Vencimento</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="31"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                                    value={newTenant.dueDay}
                                    onChange={e => setNewTenant({ ...newTenant, dueDay: e.target.value })}
                                    placeholder="Ex: 10"
                                />
                                <p className="text-xs text-slate-400 mt-1">Dia do mês (1-31)</p>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <label className="block text-xs font-bold text-blue-600 uppercase mb-2">Vincular Casa (Opcional)</label>
                            <select
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm text-slate-900"
                                value={newTenant.propertyId}
                                onChange={e => setNewTenant({ ...newTenant, propertyId: e.target.value })}
                            >
                                <option value="">-- Nenhuma --</option>
                                {properties.map(p => {
                                    const isOccupied = p.tenantId && p.tenantId !== editingId;
                                    return (
                                        <option key={p.id} value={p.id}>
                                            {p.address} {isOccupied ? '(Ocupada)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={onSave}
                        disabled={isSaving}
                        className="w-full mt-4 bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
                    >
                        {isSaving ? "Salvando..." : "Confirmar"}
                    </button>
                </div>
            </div>
        </div>
    );
};
