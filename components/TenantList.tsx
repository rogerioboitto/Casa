import React from 'react';
import { Tenant, Property } from '../types';
import { UserPlus, FileText, Trash2, Download, Edit2 } from 'lucide-react';

interface TenantListProps {
    tenants: Tenant[];
    properties: Property[];
    onAddTenant: () => void;
    onEditTenant: (tenant: Tenant) => void;
    onManageDocuments: (tenant: Tenant) => void;
    onDeleteTenant: (id: string, name: string) => void;
}

export const TenantList: React.FC<TenantListProps> = ({
    tenants,
    properties,
    onAddTenant,
    onEditTenant,
    onManageDocuments,
    onDeleteTenant
}) => {
    // Helper to find property for a tenant
    const getPropertyForTenant = (tenantId: string) => {
        return properties.find(p => p.tenantId === tenantId);
    };

    // Sort tenants by property address
    const sortedTenants = [...tenants].sort((a, b) => {
        const propA = getPropertyForTenant(a.id);
        const propB = getPropertyForTenant(b.id);

        const addrA = propA?.address || 'ZZZ'; // Unlinked tenants to the bottom
        const addrB = propB?.address || 'ZZZ';

        return addrA.localeCompare(addrB);
    });

    return (
        <div className="space-y-6 animate-fade-in">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Inquilinos</h2>
                    <p className="text-xs text-slate-500 mt-1">Gerencie os locatários e seus dados.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={onAddTenant}
                        className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl"
                    >
                        <UserPlus size={18} />
                        Novo Inquilino
                    </button>
                </div>
            </header>

            <div className="hidden md:block bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Inquilino</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Telefone</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">CPF</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Unidade</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Entrada</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Saída</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {sortedTenants.map(tenant => {
                                const property = getPropertyForTenant(tenant.id);
                                return (
                                    <tr key={tenant.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm">
                                                    {tenant.name[0]}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-900 text-sm leading-tight">{tenant.name}</h4>
                                                    <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5 font-semibold">Locatário Ativo</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-sm text-slate-600 font-medium">{tenant.email || "N/A"}</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-slate-700">{tenant.phone || "N/A"}</span>
                                                <span className="text-[10px] text-slate-400 uppercase tracking-tighter font-semibold">Contato Principal</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="font-mono text-xs font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                {tenant.cpf || "N/A"}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-semibold text-slate-700">{property?.address || "-"}</span>
                                                {property && <span className="text-[10px] text-slate-400 uppercase tracking-tighter font-semibold">Imóvel Vinculado</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-sm text-slate-600 font-medium">
                                                {tenant.entryDate ? tenant.entryDate.split('-').reverse().join('/') : '-'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-sm text-slate-600 font-medium">
                                                {tenant.exitDate ? tenant.exitDate.split('-').reverse().join('/') : '-'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className="flex justify-center gap-1">
                                                <button
                                                    onClick={() => onManageDocuments(tenant)}
                                                    className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-xl transition-all relative"
                                                    title="Documentos"
                                                >
                                                    <FileText size={18} />
                                                    {tenant.documents && tenant.documents.length > 0 && (
                                                        <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full border border-white"></span>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => onEditTenant(tenant)}
                                                    className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
                                                    title="Editar"
                                                >
                                                    <Edit2 size={18} />
                                                </button>
                                                <button
                                                    onClick={() => onDeleteTenant(tenant.id, tenant.name)}
                                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                                    title="Excluir"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Empty State (Desktop) */}
                {tenants.length === 0 && (
                    <div className="text-center py-20 bg-white">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <UserPlus size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Nenhum inquilino encontrado</h3>
                        <p className="text-slate-500">Cadastre manualmente ou importe do Asaas.</p>
                    </div>
                )}
            </div>

            {/* --- MOBILE CARD VIEW --- */}
            <div className="md:hidden space-y-4">
                {sortedTenants.map(tenant => {
                    const property = getPropertyForTenant(tenant.id);
                    return (
                        <div key={tenant.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 relative overflow-hidden">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold text-xl shadow-sm">
                                        {tenant.name[0]}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-base leading-tight">{tenant.name}</h3>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold mt-0.5">Locatário Ativo</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3 mb-5">
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <span className="text-xs font-bold text-slate-500 uppercase">CPF</span>
                                    <span className="font-mono text-sm font-bold text-slate-700">{tenant.cpf || "N/A"}</span>
                                </div>

                                <div className="grid grid-cols-1 gap-2">
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">@</div>
                                        <span className="truncate">{tenant.email || "Sem email"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-600">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-[10px]">#</div>
                                        <span>{tenant.phone || "Sem telefone"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-900 font-semibold bg-blue-50/50 p-2 rounded-lg mt-1">
                                        <div className="w-5 h-5 rounded-md bg-blue-100 flex items-center justify-center text-blue-600 text-[9px]">🏠</div>
                                        <span className="truncate">{property?.address || "Sem imóvel vinculado"}</span>
                                    </div>
                                </div>

                                {/* Dates Section */}
                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    <div className="bg-slate-50 p-2 rounded-lg">
                                        <span className="block text-[10px] font-bold text-slate-400 uppercase">Entrada</span>
                                        <span className="block text-sm font-semibold text-slate-700">{tenant.entryDate ? tenant.entryDate.split('-').reverse().join('/') : '-'}</span>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded-lg">
                                        <span className="block text-[10px] font-bold text-slate-400 uppercase">Saída</span>
                                        <span className="block text-sm font-semibold text-slate-700">{tenant.exitDate ? tenant.exitDate.split('-').reverse().join('/') : '-'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 border-t border-slate-100 pt-4">
                                <button
                                    onClick={() => onManageDocuments(tenant)}
                                    className="flex-1 bg-amber-50 text-amber-700 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 relative"
                                >
                                    <FileText size={16} /> Docs
                                    {tenant.documents && tenant.documents.length > 0 && (
                                        <span className="absolute top-2 right-2 w-2 h-2 bg-amber-500 rounded-full"></span>
                                    )}
                                </button>
                                <button
                                    onClick={() => onEditTenant(tenant)}
                                    className="w-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center"
                                >
                                    <FileText size={18} />
                                </button>
                                <button
                                    onClick={() => onDeleteTenant(tenant.id, tenant.name)}
                                    className="w-12 bg-red-50 text-red-500 rounded-xl flex items-center justify-center"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    )
                })}

                {tenants.length === 0 && (
                    <div className="text-center py-10 bg-white rounded-2xl border border-slate-200">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                            <UserPlus size={24} className="text-slate-300" />
                        </div>
                        <p className="text-slate-400 font-bold">Nenhum inquilino encontrado</p>
                    </div>
                )}
            </div>
        </div>
    );
};