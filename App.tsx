import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import { db } from './services/db';
import { Tenant, Property, EnergyBill, WaterBill } from './types';
import { Toast } from './components/Toast';
import { TenantList } from './components/TenantList';
import { TenantDocumentsModal } from './components/TenantDocumentsModal';
import { PropertyList } from './components/PropertyList';
import { EnergyTab } from './components/EnergyTab';
import { Zap, CreditCard, Shield, Lock } from 'lucide-react';
import { authInstance } from './services/firebaseConfig';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import Login from './components/Login';
import AccessManagementTab from './components/AccessManagementTab';
import { AsaasTab } from './components/AsaasTab';
import { InstallPrompt } from './components/InstallPrompt';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('properties');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [bills, setBills] = useState<EnergyBill[]>([]);
  const [waterBills, setWaterBills] = useState<WaterBill[]>([]);

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null); // null = checking
  const [authLoading, setAuthLoading] = useState(true);

  // Feedback State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  // Independent filter states for each tab
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [filterMonthEnergy, setFilterMonthEnergy] = useState<string>(currentMonth);
  const [filterMonthAsaas, setFilterMonthAsaas] = useState<string>(currentMonth);

  // Modal states
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
  const [selectedTenantForDocs, setSelectedTenantForDocs] = useState<Tenant | null>(null);

  // Form states - Tenant
  const [newTenant, setNewTenant] = useState({
    name: '',
    email: '',
    phone: '',
    cpf: '',
    propertyId: '',
    dueDay: '',
    asaasCustomerId: '',
    entryDate: '',
    exitDate: ''
  });
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);

  // Form states - Property
  const [newProperty, setNewProperty] = useState({
    address: '',
    baseRent: 0,
    tenantId: '',
    mainMeterId: '',
    waterMeterId: '',
    subMeterId: '',
    waterSubMeterId: ''
  });
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);

  // Loading state
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Real-time subscriptions
    const unsubTenants = db.subscribeToTenants(setTenants);
    const unsubProperties = db.subscribeToProperties(setProperties);
    const unsubBills = db.subscribeToEnergyBills(setBills);
    const unsubWaterBills = db.subscribeToWaterBills(setWaterBills);

    return () => {
      unsubTenants();
      unsubProperties();
      unsubBills();
      unsubWaterBills();
    };
  }, []);

  // One-time migration trigger
  useEffect(() => {
    const hasMigrated = localStorage.getItem('hasMigratedSplitSchema');
    if (!hasMigrated) {
      db.migrateBillsToSplitSchema().then(() => {
        localStorage.setItem('hasMigratedSplitSchema', 'true');
        showToast("Otimização do banco de dados concluída!", 'success');
      }).catch(err => {
        console.error("Erro na migração:", err);
      });
    }
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(authInstance, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Verifica se o e-mail está na whitelist
        const allowed = await db.isEmailAllowed(firebaseUser.email || '');

        if (!allowed) {
          // Se lista estiver vazia (primeiro acesso), adiciona o rogerioboitto@gmail.com
          const emails = await db.getAllowedEmails();
          if (emails.length === 0 && firebaseUser.email === 'rogerioboitto@gmail.com') {
            await db.addAllowedEmail('rogerioboitto@gmail.com');
            setIsAuthorized(true);
          } else {
            setIsAuthorized(allowed);
          }
        } else {
          setIsAuthorized(true);
        }
      } else {
        setIsAuthorized(false);
      }
      setAuthLoading(false);
    });

    return () => unsubAuth();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  };

  // Helper Functions
  const formatCPF = (value: string) => {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  };

  // --- Handlers ---

  const handleAddBill = async (bill: EnergyBill): Promise<boolean> => {
    try {
      // Remove ID temporário se existir, pois o Firebase cria um novo
      const { id, ...billData } = bill;
      await db.addEnergyBill(billData);

      // Recarrega dados do banco para garantir consistência e evitar problemas de cache/estado visual
      // await loadData();
      return true;
    } catch (error) {
      console.error(error);
      showToast("Erro ao salvar fatura no banco.", 'error');
      return false;
    }
  };

  const handleDeleteBill = async (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir esta fatura?")) {
      try {
        console.log("Tentando excluir fatura ID:", id);
        await db.deleteEnergyBill(id);

        // Atualização funcional do estado para garantir consistência
        // Atualização automática via snapshot
        // setBills(prevBills => prevBills.filter(b => b.id !== id));

        showToast("Fatura removida.", 'success');
      } catch (error) {
        console.error("Erro ao excluir:", error);
        showToast("Erro ao excluir fatura.", 'error');
      }
    }
  };

  const handleAddWaterBill = async (bill: WaterBill): Promise<boolean> => {
    try {
      const { id, ...billData } = bill;
      await db.addWaterBill(billData);
      // await loadData();
      return true;
    } catch (error) {
      console.error(error);
      showToast("Erro ao salvar conta de água.", 'error');
      return false;
    }
  };

  const handleDeleteWaterBill = async (id: string) => {
    if (window.confirm("Excluir esta conta de água?")) {
      try {
        await db.deleteWaterBill(id);
        // setWaterBills(prev => prev.filter(b => b.id !== id));
        showToast("Conta de água removida.", 'success');
      } catch (error) {
        showToast("Erro ao excluir conta.", 'error');
      }
    }
  };

  const handleAddTenant = async () => {
    if (!newTenant.name || !newTenant.cpf) {
      showToast("Nome e CPF são obrigatórios.", 'error');
      return;
    }

    setIsSaving(true);

    if (newTenant.cpf) {
      const existingTenant = tenants.find(t => t.cpf === newTenant.cpf);
      if (existingTenant && existingTenant.id !== editingTenantId) {
        showToast("Já existe um inquilino com este CPF.", 'error');
        setIsSaving(false);
        return;
      }
    }

    try {
      let tenantId: string;

      if (editingTenantId) {
        const tenantUpdates: any = {
          name: newTenant.name,
          email: newTenant.email,
          phone: newTenant.phone,
          cpf: newTenant.cpf
        };

        if (newTenant.propertyId) tenantUpdates.propertyId = newTenant.propertyId;
        if (newTenant.dueDay) tenantUpdates.dueDay = parseInt(newTenant.dueDay);
        if (newTenant.asaasCustomerId) tenantUpdates.asaasCustomerId = newTenant.asaasCustomerId;
        if (newTenant.entryDate) tenantUpdates.entryDate = newTenant.entryDate;
        if (newTenant.exitDate) tenantUpdates.exitDate = newTenant.exitDate;

        await db.updateTenant(editingTenantId, tenantUpdates);
        tenantId = editingTenantId;
        showToast("Inquilino atualizado com sucesso!", 'success');
      } else {
        const tenantData: any = {
          name: newTenant.name,
          email: newTenant.email,
          phone: newTenant.phone,
          cpf: newTenant.cpf,
          documents: []
        };

        if (newTenant.propertyId) tenantData.propertyId = newTenant.propertyId;
        if (newTenant.dueDay) tenantData.dueDay = parseInt(newTenant.dueDay);
        if (newTenant.asaasCustomerId) tenantData.asaasCustomerId = newTenant.asaasCustomerId;
        if (newTenant.entryDate) tenantData.entryDate = newTenant.entryDate;
        if (newTenant.exitDate) tenantData.exitDate = newTenant.exitDate;

        const newTenantDoc = await db.addTenant(tenantData);
        tenantId = newTenantDoc.id;
        showToast("Inquilino cadastrado com sucesso!", 'success');
      }

      if (newTenant.propertyId) {
        const property = properties.find(p => p.id === newTenant.propertyId);
        if (property) {
          if (property.tenantId && property.tenantId !== tenantId) {
            if (window.confirm(`A casa "${property.address}" já tem um inquilino. Substituir?`)) {
              await db.updateProperty(property.id, { tenantId: tenantId });
            }
          } else {
            await db.updateProperty(property.id, { tenantId: tenantId });
          }
        }
      }

      setNewTenant({ name: '', email: '', phone: '', cpf: '', propertyId: '', dueDay: '', asaasCustomerId: '', entryDate: '', exitDate: '' });
      setIsTenantModalOpen(false);
      // loadData();
    } catch (error: any) {
      console.error("Erro:", error);
      showToast("Erro ao salvar inquilino.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const openTenantModal = (tenant?: Tenant) => {
    if (tenant) {
      // Edit Mode
      const property = properties.find(p => p.tenantId === tenant.id);
      setNewTenant({
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        cpf: tenant.cpf || '',
        propertyId: property ? property.id : '',
        dueDay: tenant.dueDay ? tenant.dueDay.toString() : '',
        asaasCustomerId: tenant.asaasCustomerId || '',
        entryDate: tenant.entryDate || '',
        exitDate: tenant.exitDate || ''
      });
      setEditingTenantId(tenant.id);
    } else {
      // New Mode
      setNewTenant({ name: '', email: '', phone: '', cpf: '', propertyId: '', dueDay: '', asaasCustomerId: '', entryDate: '', exitDate: '' });
      setEditingTenantId(null);
    }
    setIsTenantModalOpen(true);
  };

  const handleDeleteTenant = async (id: string, name: string) => {
    if (window.confirm(`Excluir "${name}"?`)) {
      try {
        await db.deleteTenant(id);
        const property = properties.find(p => p.tenantId === id);
        if (property) {
          await db.updateProperty(property.id, { tenantId: '' });
        }
        showToast("Inquilino removido.", 'success');
        // loadData();
      } catch (error) {
        showToast("Erro ao excluir.", 'error');
      }
    }
  };

  const handleSaveProperty = async () => {
    if (!newProperty.address || !newProperty.mainMeterId) {
      showToast("Endereço e Código CPFL são obrigatórios.", 'error');
      return;
    }
    setIsSaving(true);
    try {
      if (editingPropertyId) {
        await db.updateProperty(editingPropertyId, newProperty);
        showToast("Propriedade atualizada!", 'success');
      } else {
        await db.addProperty({ ...newProperty, lastReading: 0, lastReadingDate: '' });
        showToast("Nova propriedade criada!", 'success');
      }
      setNewProperty({ address: '', baseRent: 0, tenantId: '', mainMeterId: '', waterMeterId: '', subMeterId: '', waterSubMeterId: '' });
      setIsPropertyModalOpen(false);
      // loadData();
    } catch (error: any) {
      showToast("Erro ao salvar propriedade.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProperty = async (id: string) => {
    if (window.confirm("Excluir esta casa permanentemente?")) {
      try {
        await db.deleteProperty(id);
        setProperties(prev => prev.filter(p => p.id !== id));
        showToast("Casa excluída com sucesso.", 'success');
      } catch (error) {
        showToast("Erro ao excluir casa.", 'error');
      }
    }
  };

  const openPropertyModal = (property?: Property) => {
    if (property) {
      setNewProperty({
        address: property.address,
        baseRent: property.baseRent,
        tenantId: property.tenantId || '',
        mainMeterId: property.mainMeterId,
        waterMeterId: property.waterMeterId || '',
        subMeterId: property.subMeterId,
        waterSubMeterId: property.waterSubMeterId || ''
      });
      setEditingPropertyId(property.id);
    } else {
      setNewProperty({ address: '', baseRent: 0, tenantId: '', mainMeterId: '', waterMeterId: '', subMeterId: '', waterSubMeterId: '' });
      setEditingPropertyId(null);
    }
    setIsPropertyModalOpen(true);
  };

  const openDocsModal = (tenant: Tenant) => {
    setSelectedTenantForDocs(tenant);
    setIsDocsModalOpen(true);
  };

  // --- RENDER ---
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (isAuthorized === false) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mb-8 border border-red-500/20">
          <Lock className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Acesso Negado</h1>
        <p className="text-neutral-400 mb-8 max-w-sm">
          O e-mail <strong>{user.email}</strong> não tem autorização para acessar este sistema. Contate o administrador.
        </p>
        <button
          onClick={() => signOut(authInstance)}
          className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl transition-all font-semibold"
        >
          Sair e usar outra conta
        </button>
      </div>
    );
  }

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      <InstallPrompt />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {activeTab === 'tenants' && (
        <TenantList
          tenants={tenants}
          properties={properties}
          onAddTenant={() => openTenantModal()}
          onEditTenant={openTenantModal}
          onManageDocuments={openDocsModal}
          onDeleteTenant={handleDeleteTenant}
        />
      )}

      {activeTab === 'properties' && (
        <PropertyList
          properties={properties}
          tenants={tenants}
          onAddProperty={() => openPropertyModal()}
          onEditProperty={openPropertyModal}
          onDeleteProperty={handleDeleteProperty}
        />
      )}

      {activeTab === 'energy' && (
        <EnergyTab
          bills={bills}
          properties={properties}
          tenants={tenants}
          onAddBill={handleAddBill}
          onDeleteBill={handleDeleteBill}
          waterBills={waterBills}
          onAddWaterBill={handleAddWaterBill}
          onDeleteWaterBill={handleDeleteWaterBill}
          showToast={showToast}
          filterMonth={filterMonthEnergy}
          setFilterMonth={setFilterMonthEnergy}
        />
      )}

      {activeTab === 'asaas' && (
        <AsaasTab
          tenants={tenants}
          properties={properties}
          bills={bills}
          waterBills={waterBills}
          filterMonth={filterMonthAsaas}
          setFilterMonth={setFilterMonthAsaas}
        />
      )}

      {activeTab === 'security' && (
        <AccessManagementTab usageData={{
          counts: {
            tenants: tenants.length,
            properties: properties.length,
            bills: bills.length,
            waterBills: waterBills.length
          }
        }} />
      )}

      {/* --- MODALS --- */}
      {isTenantModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
            <div className="bg-slate-900 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{editingTenantId ? 'Editar Inquilino' : 'Novo Inquilino'}</h3>
              <button
                onClick={() => setIsTenantModalOpen(false)}
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
                      const isOccupied = p.tenantId && p.tenantId !== editingTenantId;
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
                onClick={handleAddTenant}
                disabled={isSaving}
                className="w-full mt-4 bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
              >
                {isSaving ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPropertyModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{editingPropertyId ? 'Editar Casa' : 'Nova Casa'}</h3>
              <button
                onClick={() => setIsPropertyModalOpen(false)}
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
                onClick={handleSaveProperty}
                disabled={isSaving}
                className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-slate-900/20"
              >
                {isSaving ? "Salvando..." : "Salvar Unidade"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- DOCS MODAL --- */}
      {isDocsModalOpen && selectedTenantForDocs && (
        <TenantDocumentsModal
          isOpen={isDocsModalOpen}
          onClose={() => setIsDocsModalOpen(false)}
          tenant={selectedTenantForDocs}
          onUpdateTenant={(updated) => {
            setTenants(prev => prev.map(t => t.id === updated.id ? updated : t));
            setSelectedTenantForDocs(updated);
          }}
          showToast={showToast}
        />
      )}
    </Layout>
  );
};

export default App;