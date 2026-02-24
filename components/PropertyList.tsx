import React from 'react';
import { Property, Tenant } from '../types';
import { Plus, UserPlus, FileText, Zap, Trash2 } from 'lucide-react';

interface PropertyListProps {
    properties: Property[];
    tenants: Tenant[];
    onAddProperty: () => void;
    onEditProperty: (property: Property) => void;
    onDeleteProperty: (id: string) => void;
}

export const PropertyList: React.FC<PropertyListProps> = ({
    properties,
    tenants,
    onAddProperty,
    onEditProperty,
    onDeleteProperty
}) => {
    // Ordenação Alfanumérica (Casa 1, Casa 2, Casa 10...)
    const sortedProperties = [...properties].sort((a, b) =>
        a.address.localeCompare(b.address, undefined, { numeric: true, sensitivity: 'base' })
    );

    return (
        <div className="space-y-6 animate-fade-in">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Unidades</h2>
                    <p className="text-slate-500 mt-1">Gerencie suas propriedades e vinculações.</p>
                </div>
                <button
                    onClick={onAddProperty}
                    className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl"
                >
                    <Plus size={18} />
                    Cadastrar Casa
                </button>
            </header>

            <div className="hidden md:block bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Unidade / Endereço</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Medidor</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Aluguel Base</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Inquilino Atual</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Última Leitura</th>
                                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {sortedProperties.map(property => {
                                const tenant = tenants.find(t => t.id === property.tenantId);
                                return (
                                    <tr key={property.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2.5 h-2.5 rounded-full ${tenant ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-slate-300'}`}></div>
                                                <span className={`text-[10px] font-bold uppercase tracking-wider ${tenant ? 'text-blue-600' : 'text-slate-500'}`}>
                                                    {tenant ? 'Ocupada' : 'Disponível'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="font-bold text-slate-900 text-base">{property.address}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">Propriedade Ativa</div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                                                {property.mainMeterId || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <span className="text-[10px] text-slate-400 font-bold uppercase">R$</span>
                                                <span className="font-bold text-slate-900 text-lg">{property.baseRent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-lg ${tenant ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-300'}`}>
                                                    <UserPlus size={14} />
                                                </div>
                                                <div>
                                                    <p className={`text-sm font-bold ${tenant ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                                                        {tenant ? tenant.name : "Nenhum vinculado"}
                                                    </p>
                                                    {tenant && <p className="text-[10px] text-slate-400 uppercase tracking-tighter">Inquilino Ativo</p>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                                                    <Zap size={14} className="text-amber-500" />
                                                </div>
                                                <span className="text-sm font-bold text-slate-700 font-mono">
                                                    {property.lastReading ? `${property.lastReading} kWh` : "-"}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => onEditProperty(property)}
                                                    className="text-slate-400 hover:text-blue-600 transition-all p-2 hover:bg-blue-50 rounded-xl"
                                                    title="Editar"
                                                >
                                                    <FileText size={18} />
                                                </button>
                                                <button
                                                    onClick={() => onDeleteProperty(property.id)}
                                                    className="text-slate-400 hover:text-red-500 transition-all p-2 hover:bg-red-50 rounded-xl"
                                                    title="Excluir"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {properties.length === 0 && (
                    <div className="text-center py-20 bg-white">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Plus size={32} className="text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Comece cadastrando uma casa</h3>
                        <p className="text-slate-500">Adicione suas unidades para começar a vincular inquilinos.</p>
                        <button
                            onClick={onAddProperty}
                            className="mt-4 text-blue-600 font-bold hover:underline"
                        >
                            Cadastrar agora
                        </button>
                    </div>
                )}
            </div>

            {/* --- MOBILE CARD VIEW --- */}
            <div className="md:hidden space-y-4">
                {sortedProperties.map(property => {
                    const tenant = tenants.find(t => t.id === property.tenantId);
                    return (
                        <div key={property.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 relative overflow-hidden">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-bold text-slate-900 text-lg leading-tight">{property.address}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className={`w-2 h-2 rounded-full ${tenant ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${tenant ? 'text-blue-600' : 'text-slate-500'}`}>
                                            {tenant ? 'Ocupada' : 'Disponível'}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] uppercase text-slate-400 font-bold block">Aluguel Base</span>
                                    <span className="text-lg font-bold text-slate-900">R$ {property.baseRent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            </div>

                            <div className="bg-slate-50 rounded-xl p-3 mb-4 space-y-2">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500 font-medium">Medidor (CPFL)</span>
                                    <span className="font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-100">{property.mainMeterId || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500 font-medium">Última Leitura</span>
                                    <div className="flex items-center gap-1">
                                        <Zap size={12} className="text-amber-500" />
                                        <span className="font-mono font-bold text-slate-700">{property.lastReading ? `${property.lastReading} kWh` : "-"}</span>
                                    </div>
                                </div>
                            </div>

                            {tenant && (
                                <div className="flex items-center gap-3 mb-5 p-3 border border-slate-100 rounded-xl">
                                    <div className="bg-blue-50 text-blue-600 p-2 rounded-lg">
                                        <UserPlus size={16} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase">Inquilino</p>
                                        <p className="font-bold text-slate-800 text-sm">{tenant.name}</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 border-t border-slate-100 pt-4">
                                <button
                                    onClick={() => onEditProperty(property)}
                                    className="flex-1 bg-blue-50 text-blue-600 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                                >
                                    <FileText size={16} /> Editar
                                </button>
                                <button
                                    onClick={() => onDeleteProperty(property.id)}
                                    className="w-12 bg-red-50 text-red-500 rounded-xl flex items-center justify-center"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    );
                })}

                {properties.length === 0 && (
                    <div className="text-center py-10 bg-white rounded-2xl border border-slate-200">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Plus size={24} className="text-slate-300" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900 mb-1">Sem propriedades</h3>
                        <button
                            onClick={onAddProperty}
                            className="text-blue-600 font-bold text-sm hover:underline"
                        >
                            Cadastrar agora
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};