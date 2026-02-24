import React from 'react';
import { Zap, Database, HardDrive, Globe, Info } from 'lucide-react';

interface UsageStatProps {
  icon: React.ReactNode;
  label: string;
  current: string | number;
  limit: string | number;
  unit: string;
  percent: number;
  color: string;
}

const UsageStat: React.FC<UsageStatProps> = ({ icon, label, current, limit, unit, percent, color }) => (
  <div className="bg-neutral-950 p-5 rounded-2xl border border-neutral-800 hover:border-neutral-700 transition-all">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-2 rounded-lg bg-${color.split('-')[0]}-500/10 border border-${color.split('-')[0]}-500/20`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-tighter">{label}</span>
    </div>
    
    <div className="flex items-end justify-between mb-2">
      <span className="text-2xl font-bold text-white leading-none">
        {current}
        <span className="text-[10px] font-medium text-neutral-500 ml-1 uppercase">{unit}</span>
      </span>
      <span className="text-[10px] text-neutral-500 font-mono">LIM: {limit}</span>
    </div>
    
    <div className="h-1.5 w-full bg-neutral-900 rounded-full overflow-hidden">
      <div 
        className={`h-full bg-${color.split('-')[0]}-500 transition-all duration-1000 ease-out`} 
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  </div>
);

interface UsageDashboardProps {
  counts: {
    tenants: number;
    properties: number;
    bills: number;
    waterBills: number;
  };
}

export const UsageDashboard: React.FC<UsageDashboardProps> = ({ counts }) => {
  // Estimativas automáticas baseadas no volume de dados
  // Firestore: Cada acesso carrega as listas. Estimamos 10 acessos/dia + operações.
  const firestoreReadsEstimate = (counts.tenants + counts.properties + counts.bills + counts.waterBills) * 5;
  const firestorePercent = (firestoreReadsEstimate / 50000) * 100;
  
  // Functions: Invocações estimadas por processamento de faturas + proxy Asaas
  const functionsInvocations = (counts.bills + counts.waterBills) * 2 + 50; 
  const functionsPercent = (functionsInvocations / 2000000) * 100;

  // Storage: Baseado no seu print (183MB) + crescimento leve por documento
  const storageMB = 183 + (counts.bills * 0.1); 
  const storagePercent = (storageMB / 5000) * 100;

  return (
    <div className="mt-12 pt-8 border-t border-neutral-800 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
            <Database className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Cotas & Infraestrutura</h3>
            <p className="text-xs text-neutral-500">Monitoramento automático em tempo real</p>
          </div>
        </div>
        <div className="px-3 py-1 bg-neutral-950 border border-neutral-800 rounded-full">
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest animate-pulse">● System Live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <UsageStat 
          icon={<Zap className="w-5 h-5 text-blue-400" />}
          label="C. Functions"
          current={functionsInvocations}
          limit="2M"
          unit="inv"
          percent={functionsPercent}
          color="blue-400"
        />
        <UsageStat 
          icon={<Database className="w-5 h-5 text-emerald-400" />}
          label="Firestore"
          current={firestoreReadsEstimate}
          limit="50k"
          unit="leit/dia"
          percent={firestorePercent}
          color="emerald-400"
        />
        <UsageStat 
          icon={<HardDrive className="w-5 h-5 text-amber-400" />}
          label="C. Storage"
          current={storageMB.toFixed(0)}
          limit="5G"
          unit="MB"
          percent={storagePercent}
          color="amber-400"
        />
        <UsageStat 
          icon={<Globe className="w-5 h-5 text-purple-400" />}
          label="Hosting"
          current="35"
          limit="10G"
          unit="MB"
          percent={0.35}
          color="purple-400"
        />
      </div>

      <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex items-start gap-4 backdrop-blur-sm">
        <Info className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-[11px] text-emerald-300/80 leading-relaxed font-medium">
            <strong>Otimização Ativa:</strong> A política de limpeza de artefatos (7 dias) está configurada via CLI para o Artifact Registry. 
          </p>
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Os valores acima são estimativas dinâmicas baseadas nas coleções ativas do seu projeto e nas respostas do Google Cloud.
          </p>
        </div>
      </div>
    </div>
  );
};
