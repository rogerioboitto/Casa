
import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import { db } from './services/db';
import { Tenant, Property, EnergyBill, WaterBill } from './types';
import { Toast } from './components/Toast';
import { TenantList } from './components/TenantList';
import { TenantDocumentsModal } from './components/TenantDocumentsModal';
import { PropertyList } from './components/PropertyList';
import { EnergyTab } from './components/EnergyTab';
import { authInstance } from './services/firebaseConfig';
import { signOut } from 'firebase/auth';
import Login from './components/Login';
import AccessManagementTab from './components/AccessManagementTab';
import { Asaas2Tab } from './components/Asaas2Tab';
import { InstallPrompt } from './components/InstallPrompt';
import { Lock } from 'lucide-react';
import { useAppState } from './hooks/useAppState';
import { TenantModal } from './components/TenantModal';
import { PropertyModal } from './components/PropertyModal';

const App: React.FC = () => {
  const {
    tenants, setTenants,
    properties, setProperties,
    bills,
    waterBills,
    user,
    isAuthorized,
    authLoading,
    activeTab, setActiveTab,
    toast, setToast,
    showToast
  } = useAppState();

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [filterMonthEnergy, setFilterMonthEnergy] = useState<string>(currentMonth);

  // Modal states
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
  const [selectedTenantForDocs, setSelectedTenantForDocs] = useState<Tenant | null>(null);

  // Form states - Tenant
  const [newTenant, setNewTenant] = useState({
    name: '', email: '', phone: '', cpf: '', propertyId: '',
    dueDay: '', asaasCustomerId: '', entryDate: '', exitDate: ''
  });
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);

  // Form states - Property
  const [newProperty, setNewProperty] = useState({
    address: '', baseRent: 0, tenantId: '', mainMeterId: '',
    waterMeterId: '', subMeterId: '', waterSubMeterId: ''
  });
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  // One-time migration trigger - Otimizado para rodar apenas se necessário
  useEffect(() => {
    if (isAuthorized) {
      const hasMigrated = localStorage.getItem('hasMigratedSplitSchema');
      if (!hasMigrated) {
        db.migrateBillsToSplitSchema().then(() => {
          localStorage.setItem('hasMigratedSplitSchema', 'true');
          showToast("Otimização do banco de dados concluída!", 'success');
        }).catch(err => {
          console.error("Erro na migração:", err);
        });
      }
    }
  }, [isAuthorized]);

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
      const { id, ...billData } = bill;
      await db.addEnergyBill(billData);
      return true;
    } catch (error) {
      showToast("Erro ao salvar fatura no banco.", 'error');
      return false;
    }
  };

  const handleDeleteBill = async (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir esta fatura?")) {
      try {
        await db.deleteEnergyBill(id);
        showToast("Fatura removida.", 'success');
      } catch (error) {
        showToast("Erro ao excluir fatura.", 'error');
      }
    }
  };

  const handleAddWaterBill = async (bill: WaterBill): Promise<boolean> => {
    try {
      const { id, ...billData } = bill;
      await db.addWaterBill(billData);
      return true;
    } catch (error) {
      showToast("Erro ao salvar conta de água.", 'error');
      return false;
    }
  };

  const handleDeleteWaterBill = async (id: string) => {
    if (window.confirm("Excluir esta conta de água?")) {
      try {
        await db.deleteWaterBill(id);
        showToast("Conta de água removida.", 'success');
      } catch (error) {
        showToast("Erro ao excluir conta.", 'error');
      }
    }
  };

  const handleSaveTenant = async () => {
    if (!newTenant.name || !newTenant.cpf) {
      showToast("Nome e CPF são obrigatórios.", 'error');
      return;
    }
    setIsSaving(true);
    try {
      let tenantId: string;
      if (editingTenantId) {
        const tenantUpdates: any = { ...newTenant, dueDay: newTenant.dueDay ? parseInt(newTenant.dueDay) : undefined };
        await db.updateTenant(editingTenantId, tenantUpdates);
        tenantId = editingTenantId;
        showToast("Inquilino atualizado!", 'success');
      } else {
        const tenantData: any = { ...newTenant, dueDay: newTenant.dueDay ? parseInt(newTenant.dueDay) : undefined, documents: [] };
        const newTenantDoc = await db.addTenant(tenantData);
        tenantId = newTenantDoc.id;
        showToast("Inquilino cadastrado!", 'success');
      }

      if (newTenant.propertyId) {
        const property = properties.find(p => p.id === newTenant.propertyId);
        if (property && property.tenantId !== tenantId) {
          await db.updateProperty(property.id, { tenantId: tenantId });
        }
      }
      setIsTenantModalOpen(false);
    } catch (error: any) {
      showToast("Erro ao salvar inquilino.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const openTenantModal = (tenant?: Tenant) => {
    if (tenant) {
      const property = properties.find(p => p.tenantId === tenant.id);
      setNewTenant({
        ...tenant,
        propertyId: property ? property.id : '',
        dueDay: tenant.dueDay ? tenant.dueDay.toString() : '',
        cpf: tenant.cpf || ''
      });
      setEditingTenantId(tenant.id);
    } else {
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
        if (property) await db.updateProperty(property.id, { tenantId: '' });
        showToast("Inquilino removido.", 'success');
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
      setIsPropertyModalOpen(false);
    } catch (error: any) {
      showToast("Erro ao salvar propriedade.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const openPropertyModal = (property?: Property) => {
    if (property) {
      setNewProperty({ ...property, tenantId: property.tenantId || '' });
      setEditingPropertyId(property.id);
    } else {
      setNewProperty({ address: '', baseRent: 0, tenantId: '', mainMeterId: '', waterMeterId: '', subMeterId: '', waterSubMeterId: '' });
      setEditingPropertyId(null);
    }
    setIsPropertyModalOpen(true);
  };

  const handleDeleteProperty = async (id: string) => {
    if (window.confirm("Excluir esta casa permanentemente?")) {
      try {
        await db.deleteProperty(id);
        showToast("Casa excluída com sucesso.", 'success');
      } catch (error) {
        showToast("Erro ao excluir casa.", 'error');
      }
    }
  };

  if (authLoading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
    </div>
  );

  if (!user) return <Login />;

  if (isAuthorized === false) return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 text-center">
      <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mb-8 border border-red-500/20">
        <Lock className="w-10 h-10 text-red-400" />
      </div>
      <h1 className="text-3xl font-bold text-white mb-2">Acesso Negado</h1>
      <p className="text-neutral-400 mb-8 max-w-sm">
        O e-mail <strong>{user.email}</strong> não tem autorização.
      </p>
      <button onClick={() => signOut(authInstance)} className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl transition-all font-semibold">
        Sair e usar outra conta
      </button>
    </div>
  );

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
          onManageDocuments={(t) => { setSelectedTenantForDocs(t); setIsDocsModalOpen(true); }}
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

      {activeTab === 'asaas2' && (
        <Asaas2Tab tenants={tenants} properties={properties} bills={bills} waterBills={waterBills} />
      )}

      {activeTab === 'security' && (
        <AccessManagementTab usageData={{ counts: { tenants: tenants.length, properties: properties.length, bills: bills.length, waterBills: waterBills.length } }} />
      )}

      <TenantModal
        isOpen={isTenantModalOpen}
        onClose={() => setIsTenantModalOpen(false)}
        onSave={handleSaveTenant}
        newTenant={newTenant}
        setNewTenant={setNewTenant}
        isSaving={isSaving}
        editingId={editingTenantId}
        properties={properties}
        formatCPF={formatCPF}
      />

      <PropertyModal
        isOpen={isPropertyModalOpen}
        onClose={() => setIsPropertyModalOpen(false)}
        onSave={handleSaveProperty}
        newProperty={newProperty}
        setNewProperty={setNewProperty}
        isSaving={isSaving}
        editingId={editingPropertyId}
        tenants={tenants}
      />

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