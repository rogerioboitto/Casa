export interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  cpf?: string;
  propertyId?: string;
  // documents: string[]; // LEGADO - Removido em favor de TenantDocument[]
  asaasCustomerId?: string; // ID do cliente no Asaas
  dueDay?: number; // Dia do mês para vencimento (1-31)
  entryDate?: string; // YYYY-MM-DD
  exitDate?: string; // YYYY-MM-DD
  documents?: TenantDocument[]; // Lista de documentos
}

export interface TenantDocument {
  id: string;
  name: string; // Ex: "Contrato.pdf"
  type: string; // Ex: "Contrato", "CNH", "Vistoria"
  url: string;
  uploadedAt: string;
}

export interface Property {
  id: string;
  address: string;
  baseRent: number;
  tenantId?: string;
  mainMeterId: string; // Installation Code (CPFL)
  waterMeterId?: string; // Installation Code (SAAE)
  waterSubMeterId?: string; // Internal ID for Water
  subMeterId: string; // Internal ID (Energy)
  lastReading?: number;
  lastReadingDate?: string;
  lastWaterReading?: number;
  lastWaterReadingDate?: string;
}

export interface WaterBill {
  id: string;
  fileName: string;
  fileUrl?: string;
  referenceMonth: string; // YYYY-MM
  m3UnitCost: number; // Custo por m3 (Água + Esgoto)
  totalAmount?: number; // Valor total da fatura (opcional, se não calculado)
  refundAmount?: number;
  installationCode?: string; // RGI / Matrícula
  propertyId?: string;
  currentReading?: number;
  meterSerial?: string;
  masterConsumption?: number; // Consumo total m3 da fatura principal
  uploadedAt: string;
  hasContent?: boolean; // Se true, o conteúdo está em water_bill_contents
}

export interface EnergyBill {
  id: string;
  fileName: string;
  fileUrl?: string; // Base64 data or Storage URL
  referenceMonth: string; // YYYY-MM
  kwhUnitCost: number;
  flagAdditionalCost?: number; // Novo campo: Valor R$ do adicional de bandeira
  refundAmount?: number;      // Novo campo: Valor R$ de devolução
  installationCode?: string;  // Novo campo: Código da Instalação (para vincular com Casas)
  propertyId?: string;        // Novo campo: ID da casa específica (quando o código vincula a múltiplas casas)
  currentReading?: number;    // Novo campo: Leitura atual extraída da foto do medidor
  meterSerial?: string;       // Novo campo: Número de série do medidor extraído
  masterConsumption?: number; // Novo campo: Consumo total kWh da fatura principal (CPFL)
  uploadedAt: string;
  hasContent?: boolean; // Se true, o conteúdo (Base64) está em energy_bill_contents
}