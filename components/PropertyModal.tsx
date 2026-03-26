
import React from 'react';
import { Tenant, Property } from '../types';
import { Zap } from 'lucide-react';

interface PropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  newProperty: any;
  setNewProperty: (prop: any) => void;
  isSaving: boolean;
  editingId: string | null;
  tenants: Tenant[];
}

export const PropertyModal: React.FC<PropertyModalProps> = ({
  isOpen, onClose, onSave, newProperty, setNewProperty, isSaving, editingId, tenants
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-slate-900 px-6 py-4 flex justify-between items-center">
          <h3 className="text-lg font-bold text-white">{editingId ? 'Editar Casa' : 'Nova Casa'}</h3>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white text-2xl leading-none"
          >×</button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Identificação / Endereço</label>
              <input
                placeholder="Ex: Casa 1 - Rua X"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                value={newProperty.address}
                onChange={e => setNewProperty({ ...newProperty, address: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Aluguel (R$)</label>
              <input
                type="number"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                value={newProperty.baseRent || ''}
                onChange={e => setNewProperty({ ...newProperty, baseRent: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />
              Dados de Energia (CPFL)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <input
                  placeholder="Cód. Instalação"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  value={newProperty.mainMeterId}
                  onChange={e => setNewProperty({ ...newProperty, mainMeterId: e.target.value })}
                />
              </div>
              <div>
                <input
                  placeholder="Identificador Interno"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  value={newProperty.subMeterId}
                  onChange={e => setNewProperty({ ...newProperty, subMeterId: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <span className="text-blue-500">💧</span>
              Dados de Água (SAAE)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <input
                  placeholder="Cód. Instalação"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  value={newProperty.waterMeterId || ''}
                  onChange={e => setNewProperty({ ...newProperty, waterMeterId: e.target.value })}
                />
              </div>
              <div>
                <input
                  placeholder="Identificador Interno"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  value={newProperty.waterSubMeterId || ''}
                  onChange={e => setNewProperty({ ...newProperty, waterSubMeterId: e.target.value })}
                />
              </div>
            </div>
          </div>

          <button
            onClick={onSave}
            disabled={isSaving}
            className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-slate-900/20"
          >
            {isSaving ? "Salvando..." : "Salvar Unidade"}
          </button>
        </div>
      </div>
    </div>
  );
};
