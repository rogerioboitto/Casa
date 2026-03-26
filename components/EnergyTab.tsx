import React, { useRef, useState, useMemo, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, Zap, ExternalLink, Trash2, AlertTriangle, RotateCcw, Home, Droplets, Edit2, Eye, Save, X, FileDown, MessageCircle, DollarSign, CreditCard, Camera } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { EnergyBill, WaterBill, Property, Tenant } from '../types';
import { aiService } from '../services/aiService';
import { db } from '../services/db';
import { createPayment, createCustomer, getCustomerByCpf, calculateDueDate, uploadPaymentDocument } from '../services/asaasService';

interface EnergyTabProps {
  bills: EnergyBill[];
  waterBills: WaterBill[];
  properties: Property[];
  tenants: Tenant[];
  onAddBill: (bill: EnergyBill) => Promise<boolean>;
  onDeleteBill: (id: string) => void;
  onAddWaterBill: (bill: WaterBill) => Promise<boolean>;
  onDeleteWaterBill: (id: string) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  filterMonth: string;
  setFilterMonth: (month: string) => void;
}


// --- HELPERS FORA DO COMPONENTE PARA EVITAR TDZ ---

// Cache global para evitar múltiplas conversões da mesma imagem
const imageCache = new Map<string, string>();

// Função auxiliar para converter URL em Base64 (necessário para jsPDF processar URLs externas com segurança)
const imageUrlToBase64 = async (url: string, timeout = 5000): Promise<string> => {
  if (!url) return '';
  if (imageCache.has(url)) return imageCache.get(url)!;
  if (url.startsWith('data:')) {
    imageCache.set(url, url);
    return url;
  }
  
  const processImage = async (): Promise<string> => {
    // Tenta primeiro carregar via Firebase Storage getBlob
    if (url.includes('firebasestorage.googleapis.com')) {
      try {
        const { ref: sRef, getBlob: sGetBlob } = await import('firebase/storage');
        const { storageInstance } = await import('../services/firebaseConfig');
        let storageRef;
        try {
          storageRef = sRef(storageInstance, url);
        } catch (e) {
          const decodedUrl = decodeURIComponent(url);
          const match = decodedUrl.match(/\/o\/(.+?)(\?|$)/);
          if (match && match[1]) {
            storageRef = sRef(storageInstance, match[1]);
          } else {
            throw e;
          }
        }
        
        const blob = await sGetBlob(storageRef);
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string || '');
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Falha ao carregar via getBlob, tentando método tradicional:", url, e);
      }
    }

    // Método tradicional (Image + Canvas)
    const cleanUrl = (url.includes('firebasestorage') && url.includes('token=')) 
      ? url 
      : url + (url.includes('?') ? '&' : '?') + 'cache_bust=' + Date.now();

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; 
      const timer = setTimeout(() => {
        console.warn("Timeout ao carregar imagem:", url);
        resolve('');
      }, timeout);

      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(''); return; }
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (e) {
          console.error("Erro canvas:", e);
          resolve('');
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        console.warn("Erro no carregamento da imagem, tentando fetch:", url);
        fetch(url, { mode: 'cors' })
          .then(r => r.blob())
          .then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string || '');
            reader.readAsDataURL(blob);
          })
          .catch(() => resolve(''));
      };
      img.src = cleanUrl;
    });
  };

  const result = await Promise.race([
    processImage(),
    new Promise<string>((resolve) => setTimeout(() => {
      console.warn("Timeout global estrito atingido para a imagem:", url);
      resolve('');
    }, timeout))
  ]);

  imageCache.set(url, result);
  return result;
};

const getPreviousMonth = (monthStr: string) => {
  if (!monthStr || !monthStr.includes('-')) return null;
  try {
    const [year, month] = monthStr.split('-').map(Number);
    if (isNaN(year) || isNaN(month)) return null;
    const date = new Date(year, month - 1 - 1, 1);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 7);
  } catch (e) {
    console.error("Erro ao calcular mês anterior:", e);
    return null;
  }
};

// Helper para comprimir imagem
const compressImage = (base64Str: string, maxWidth = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64Str); // Fallback: retorna original se der erro
  });
};

const strToKey = (str?: string) => str ? str.replace(/\W/g, '_') : 'unknown';

// Helper para gerar IDs compatível com navegadores antigos
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

export const EnergyTab: React.FC<EnergyTabProps> = ({ bills, waterBills, properties, tenants, onAddBill, onDeleteBill, onAddWaterBill, onDeleteWaterBill, showToast, filterMonth, setFilterMonth }) => {

  const fileInputRef = useRef<HTMLInputElement>(null);
  const meterInputRef = useRef<HTMLInputElement>(null);
  const energyCameraInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isProcessingReading, setIsProcessingReading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null);

  // Stats para Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // State for Month Selection Modal
  const [showMonthModal, setShowMonthModal] = useState(false);
  const [readingMonth, setReadingMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }); // Default: Current Month YYYY-MM

  // --- WATER STATE ---
  const waterFileInputRef = useRef<HTMLInputElement>(null);
  const waterMeterInputRef = useRef<HTMLInputElement>(null);
  const waterCameraInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingWater, setIsProcessingWater] = useState(false);
  const [isProcessingWaterReading, setIsProcessingWaterReading] = useState(false);
  const [waterUploadProgress, setWaterUploadProgress] = useState<{ current: number, total: number } | null>(null);
  const [filterWaterMonth, setFilterWaterMonth] = useState<string>('');
  const [uploadType, setUploadType] = useState<'energy' | 'water'>('energy');
  const [isCameraMode, setIsCameraMode] = useState(false);

  // --- UNIFIED UPLOAD STATE ---
  const unifiedFileInputRef = useRef<HTMLInputElement>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState<{ type: string, description: string, preview: string } | null>(null);
  const [classificationMessage, setClassificationMessage] = useState<string | null>(null);

  // --- HOVER PREVIEW STATE ---
  const [hoverPreview, setHoverPreview] = useState<{ url: string | null, x: number, y: number, loading: boolean, side: 'left' | 'right', noContent: boolean }>({ 
    url: null, 
    x: 0, 
    y: 0, 
    loading: false,
    side: 'right',
    noContent: false
  });

  // --- ASAAS CHARGE STATE ---
  const DISCOUNT_VALUE = 50;
  const [loadingCharge, setLoadingCharge] = useState<string | null>(null);
  const [createdCharges, setCreatedCharges] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('asaas-created-charges');
    return saved ? JSON.parse(saved) : {};
  });

  // --- READING EDIT MODAL STATE (Troca de Medidor) ---
  const [readingModal, setReadingModal] = useState<{
    show: boolean;
    type: 'energy' | 'water';
    billId: string;
    group: any;
  }>({ show: false, type: 'energy', billId: '', group: null });
  const [readingModalValue, setReadingModalValue] = useState('');
  const [currentReadingPhoto, setCurrentReadingPhoto] = useState<string | null>(null); // Foto do medidor antigo
  const [isReplacementEnabled, setIsReplacementEnabled] = useState(false);
  const [newMeterStartValue, setNewMeterStartValue] = useState('');
  const [newMeterEndValue, setNewMeterEndValue] = useState('');
  const [newMeterStartPhoto, setNewMeterStartPhoto] = useState<string | null>(null);
  const [newMeterEndPhoto, setNewMeterEndPhoto] = useState<string | null>(null);
  const [meterSerial, setMeterSerial] = useState('');
  const [isSavingReading, setIsSavingReading] = useState(false);

  // --- PAGINATION STATE ---
  const [currentPage, setCurrentPage] = useState(1);

  // --- HELPERS MOVIDOS PARA FORA ---

  const openReadingModal = async (type: 'energy' | 'water', bill: EnergyBill | WaterBill, group: any) => {
    let photoUrl = bill.fileUrl;
    if (!photoUrl && bill.hasContent) {
      if (type === 'energy') {
        photoUrl = await db.getEnergyBillContent(bill.id) || null;
      } else {
        photoUrl = await db.getWaterBillContent(bill.id) || null;
      }
    }

    setReadingModal({ show: true, type, billId: bill.id, group });
    setReadingModalValue(bill.currentReading?.toString() || '');
    setCurrentReadingPhoto(photoUrl || null);
    setIsReplacementEnabled(bill.isReplacement || false);
    setNewMeterStartValue(bill.newMeterStartReading?.toString() || '');
    setNewMeterEndValue(bill.newMeterEndReading?.toString() || '');
    setNewMeterStartPhoto(bill.newMeterStartPhotoUrl || null);
    setNewMeterEndPhoto(bill.newMeterEndPhotoUrl || null);
    
    const propertyMeter = (type === 'energy') ? group.property?.subMeterId : group.property?.waterSubMeterId;
    setMeterSerial(bill.meterSerial || propertyMeter || '');
  };

  const closeReadingModal = () => {
    setReadingModal({ show: false, type: 'energy', billId: '', group: null });
    setReadingModalValue('');
    setIsReplacementEnabled(false);
    setNewMeterStartValue('');
    setNewMeterEndValue('');
    setNewMeterStartPhoto(null);
    setNewMeterEndPhoto(null);
    setMeterSerial('');
  };

  const handleNewMeterPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'start' | 'end') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (target === 'start') setNewMeterStartPhoto(base64);
      else setNewMeterEndPhoto(base64);
    };
    reader.readAsDataURL(file);
  };

  const saveReadingModal = async () => {
    const newVal = parseFloat(readingModalValue);
    if (isNaN(newVal)) {
      showToast("Valor da leitura inválido.", 'error');
      return;
    }

    setIsSavingReading(true);
    try {
      const updates: any = { 
        currentReading: newVal, 
        isReplacement: isReplacementEnabled,
        meterSerial: meterSerial,
        updatedAt: new Date().toISOString(),
        hasContent: false // Reset flag as we are saving a direct URL
      };

      // Foto Leitura Atual (Medidor Antigo)
      if (currentReadingPhoto && currentReadingPhoto.startsWith('data:')) {
        const storageId = crypto.randomUUID();
        const { ref: storageRef, uploadString: uploadStr, getDownloadURL: getUrl } = await import('firebase/storage');
        const { storageInstance } = await import('../services/firebaseConfig');
        const sRef = storageRef(storageInstance, `readings/${readingModal.billId}_current_${storageId}.jpg`);
        await uploadStr(sRef, currentReadingPhoto, 'data_url');
        updates.fileUrl = await getUrl(sRef);
      } else {
        updates.fileUrl = currentReadingPhoto;
      }

      if (isReplacementEnabled) {
        const startVal = parseFloat(newMeterStartValue);
        const endVal = parseFloat(newMeterEndValue);
        if (isNaN(startVal) || isNaN(endVal)) {
          showToast("Valores do novo medidor inválidos.", 'error');
          setIsSavingReading(false);
          return;
        }
        updates.newMeterStartReading = startVal;
        updates.newMeterEndReading = endVal;

        // Foto Novo Início
        if (newMeterStartPhoto && newMeterStartPhoto.startsWith('data:')) {
          const storageId = crypto.randomUUID();
          const { ref: storageRef, uploadString: uploadStr, getDownloadURL: getUrl } = await import('firebase/storage');
          const { storageInstance } = await import('../services/firebaseConfig');
          const sRef = storageRef(storageInstance, `meter_replacement/${readingModal.billId}_start_${storageId}.jpg`);
          await uploadStr(sRef, newMeterStartPhoto, 'data_url');
          updates.newMeterStartPhotoUrl = await getUrl(sRef);
        } else {
          updates.newMeterStartPhotoUrl = newMeterStartPhoto;
        }

        // Foto Novo Final
        if (newMeterEndPhoto && newMeterEndPhoto.startsWith('data:')) {
          const storageId = crypto.randomUUID();
          const { ref: storageRef, uploadString: uploadStr, getDownloadURL: getUrl } = await import('firebase/storage');
          const { storageInstance } = await import('../services/firebaseConfig');
          const sRef = storageRef(storageInstance, `meter_replacement/${readingModal.billId}_end_${storageId}.jpg`);
          await uploadStr(sRef, newMeterEndPhoto, 'data_url');
          updates.newMeterEndPhotoUrl = await getUrl(sRef);
        } else {
          updates.newMeterEndPhotoUrl = newMeterEndPhoto;
        }
      } else {
        updates.newMeterStartReading = null;
        updates.newMeterEndReading = null;
        updates.newMeterStartPhotoUrl = null;
        updates.newMeterEndPhotoUrl = null;
      }

      if (readingModal.type === 'energy') {
        await db.updateEnergyBill(readingModal.billId, updates);
        // Atualiza o cadastro da unidade se o código foi alterado
        if (meterSerial && readingModal.group?.property?.id) {
          await db.updateProperty(readingModal.group.property.id, { 
            subMeterId: meterSerial 
          });
        }
      } else {
        await db.updateWaterBill(readingModal.billId, updates);
        // Atualiza o cadastro da unidade se o código foi alterado
        if (meterSerial && readingModal.group?.property?.id) {
          await db.updateProperty(readingModal.group.property.id, { 
            waterSubMeterId: meterSerial 
          });
        }
      }

      showToast("Dados salvos com sucesso!", 'success');
      closeReadingModal();
    } catch (error) {
      console.error(error);
      showToast("Erro ao salvar leitura.", 'error');
    } finally {
      setIsSavingReading(false);
    }
  };


  const sortedBills = useMemo(() => {
    return [...bills].sort((a, b) => {
      // 1. Sort by Month (Descending - Newest first)
      const monthComparison = b.referenceMonth.localeCompare(a.referenceMonth);
      if (monthComparison !== 0) return monthComparison;

      // 2. Sort by Unit/House Name (Ascending)
      let propA = a.propertyId ? properties.find(p => p.id === a.propertyId)?.address : '';
      if (!propA && a.installationCode) propA = properties.find(p => p.mainMeterId === a.installationCode)?.address;

      let propB = b.propertyId ? properties.find(p => p.id === b.propertyId)?.address : '';
      if (!propB && b.installationCode) propB = properties.find(p => p.mainMeterId === b.installationCode)?.address;

      // Fallback for missing property names
      const nameA = propA || a.installationCode || '';
      const nameB = propB || b.installationCode || '';

      return nameA.localeCompare(nameB);
    });
  }, [bills, properties]);

  // Extrair meses únicos para o filtro
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    months.add(current);
    
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
    months.add(nextMonth);

    bills.forEach(b => {
      if (b.referenceMonth && b.referenceMonth !== 'N/A') {
        months.add(b.referenceMonth);
      }
    });
    return Array.from(months).sort().reverse(); // Mais recente primeiro
  }, [bills]);

  // Agrupamento de Faturas (Leitura + Conta PDF)
  const groupedBills = useMemo(() => {
    const groups = new Map<string, { reading?: EnergyBill, invoice?: EnergyBill, property?: Property, key: string }>();

    // Filtra antes de agrupar
    const filtered = filterMonth
      ? sortedBills.filter(b => b.referenceMonth === filterMonth)
      : sortedBills;

    filtered.forEach(bill => {
      // Identifica propriedade
      let property = bill.propertyId ? properties.find(p => p.id === bill.propertyId) : undefined;
      if (!property && bill.installationCode) {
        property = properties.find(p => p.mainMeterId === bill.installationCode);
      }

      // Chave única: PropriedadeID + Mês (se não tiver propriedade, usa instalação + mês)
      const key = `${property ? property.id : (bill.installationCode || 'unknown')}_${bill.referenceMonth}`;

      if (!groups.has(key)) {
        groups.set(key, { property, key });
      }

      const group = groups.get(key)!;

      // Classifica se é Leitura (tem currentReading) ou Fatura (NÃO tem currentReading e geralmente tem kwhUnitCost)
      // Pode ser ajustado conforme a lógica do app. Aqui assumimos que Leitura sempre tem currentReading > 0 ou explicitamente definida.
      if (bill.currentReading !== undefined || bill.fileName.toLowerCase().includes('leitura')) {
        group.reading = bill;
      } else {
        group.invoice = bill;
      }
    });

    return Array.from(groups.values());
  }, [sortedBills, properties, filterMonth]);


  // Mapa de Leituras para busca rápida de mês anterior
  const readingsMap = useMemo(() => {
    const map = new Map<string, Map<string, EnergyBill>>(); // PropertyId -> Map<Month, EnergyBill>

    bills.filter(b => b.currentReading !== undefined).forEach(b => {
      const propKey = b.propertyId || b.installationCode;
      if (!propKey) return;

      if (!map.has(propKey)) {
        map.set(propKey, new Map());
      }
      map.get(propKey)!.set(b.referenceMonth, b);
    });
    return map;
  }, [bills]);

  // --- WATER MEMOS ---

  const sortedWaterBills = useMemo(() => {
    return [...waterBills].sort((a, b) => {
      const monthComparison = b.referenceMonth.localeCompare(a.referenceMonth);
      if (monthComparison !== 0) return monthComparison;

      let propA = a.propertyId ? properties.find(p => p.id === a.propertyId)?.address : '';
      if (!propA && a.installationCode) propA = properties.find(p => p.waterMeterId === a.installationCode)?.address;

      let propB = b.propertyId ? properties.find(p => p.id === b.propertyId)?.address : '';
      if (!propB && b.installationCode) propB = properties.find(p => p.waterMeterId === b.installationCode)?.address;

      const nameA = propA || a.installationCode || '';
      const nameB = propB || b.installationCode || '';

      return nameA.localeCompare(nameB);
    });
  }, [waterBills, properties]);

  const availableWaterMonths = useMemo(() => {
    const months = new Set<string>();
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    months.add(current);
    
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
    months.add(nextMonth);

    waterBills.forEach(b => {
      if (b.referenceMonth && b.referenceMonth !== 'N/A') months.add(b.referenceMonth);
    });
    return Array.from(months).sort().reverse();
  }, [waterBills]);

  const groupedWaterBills = useMemo(() => {
    const groups = new Map<string, { reading?: WaterBill, invoice?: WaterBill, property?: Property, key: string }>();
    const filtered = filterWaterMonth ? sortedWaterBills.filter(b => b.referenceMonth === filterWaterMonth) : sortedWaterBills;

    filtered.forEach(bill => {
      let property = bill.propertyId ? properties.find(p => p.id === bill.propertyId) : undefined;
      if (!property && bill.installationCode) {
        property = properties.find(p => p.waterMeterId === bill.installationCode);
      }

      const key = `${property ? property.id : (bill.installationCode || 'unknown')}_${bill.referenceMonth}`;
      if (!groups.has(key)) groups.set(key, { property, key });

      const group = groups.get(key)!;
      if (bill.currentReading !== undefined || bill.fileName.toLowerCase().includes('leitura')) {
        group.reading = bill;
      } else {
        group.invoice = bill;
      }
    });
    return Array.from(groups.values());
  }, [sortedWaterBills, properties, filterWaterMonth]);

  const waterReadingsMap = useMemo(() => {
    const map = new Map<string, Map<string, WaterBill>>();
    waterBills.filter(b => b.currentReading !== undefined).forEach(b => {
      const propKey = b.propertyId || b.installationCode;
      if (!propKey) return;
      if (!map.has(propKey)) map.set(propKey, new Map());
      map.get(propKey)!.set(b.referenceMonth, b);
    });
    return map;
  }, [waterBills]);

  const availableUnifiedMonths = useMemo(() => {
    const months = new Set<string>();
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    months.add(current);

    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
    months.add(nextMonth);

    bills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
    waterBills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
    return Array.from(months).sort().reverse();
  }, [bills, waterBills]);

  const filteredUnifiedGroups = useMemo(() => {
    const allKeys = new Set<string>();
    bills.forEach(b => allKeys.add(`${b.propertyId || b.installationCode}_${b.referenceMonth}`));
    waterBills.forEach(b => allKeys.add(`${b.propertyId || b.installationCode}_${b.referenceMonth}`));

    const groups = Array.from(allKeys).map(key => {
      const parts = key.split('_');
      const propId = parts[0];
      const month = parts[1];
      const property = properties.find(p => p.id === propId || p.mainMeterId === propId || p.waterMeterId === propId);
      
      const energyData = bills.filter(b => (b.propertyId === propId || b.installationCode === propId || (property && b.propertyId === property.id)) && b.referenceMonth === month);
      const waterData = waterBills.filter(b => (b.propertyId === propId || b.installationCode === propId || (property && b.propertyId === property.id)) && b.referenceMonth === month);

      const energyInvoice = energyData.find(b => b.currentReading === undefined);
      const energyReading = energyData.find(b => b.currentReading !== undefined);
      const waterInvoice = waterData.find(b => b.currentReading === undefined);
      const waterReading = waterData.find(b => b.currentReading !== undefined);

      const prevMonth = getPreviousMonth(month);
      const prevEnergy = prevMonth ? readingsMap.get(propId || property?.id || '')?.get(prevMonth) : null;
      const prevWater = prevMonth ? waterReadingsMap.get(propId || property?.id || '')?.get(prevMonth) : null;

      // ENERGY CALCS
      let energyConsumption = 0;
      let energyTotal = 0;
      let houseFlag = 0;
      let houseRefund = 0;
      let oldMeterCons = 0;
      let newMeterCons = 0;

      if (energyReading) {
        let consumption = 0;
        const cur = energyReading.currentReading;
        // Se o mês anterior teve troca, a leitura atual do NOVO medidor daquele mês vira a leitura ANTERIOR deste mês
        const prev = prevEnergy?.isReplacement ? prevEnergy.newMeterEndReading : prevEnergy?.currentReading;

        if (cur !== undefined && prev !== undefined) {
          oldMeterCons = cur - prev;
        }

        if (energyReading.isReplacement && energyReading.newMeterStartReading !== undefined && energyReading.newMeterEndReading !== undefined) {
          newMeterCons = energyReading.newMeterEndReading - energyReading.newMeterStartReading;
        }
        
        consumption = oldMeterCons + newMeterCons;
        energyConsumption = Math.max(0, consumption);

        if (energyInvoice) {
          const cost = energyInvoice.kwhUnitCost || 0;
          const flag = energyInvoice.flagAdditionalCost || 0;
          const refund = energyInvoice.refundAmount || 0;
          const master = energyInvoice.masterConsumption || 1;

          houseFlag = (energyConsumption * (flag / master)) || 0;
          houseRefund = (energyConsumption * (refund / master)) || 0;
          const base = energyConsumption * cost;

          energyTotal = base + houseFlag - houseRefund;
        }
      }

      // WATER CALCS
      let waterConsumption = 0;
      let waterTotal = 0;
      let oldWaterCons = 0;
      let newWaterCons = 0;

      if (waterReading) {
        const cur = waterReading.currentReading;
        // Se o mês anterior teve troca, a leitura atual do NOVO medidor daquele mês vira a leitura ANTERIOR deste mês
        const prev = prevWater?.isReplacement ? prevWater.newMeterEndReading : prevWater?.currentReading;
        
        if (cur !== undefined && prev !== undefined) {
          oldWaterCons = Math.max(0, cur - prev);
        }

        if (waterReading.isReplacement && waterReading.newMeterStartReading !== undefined && waterReading.newMeterEndReading !== undefined) {
          newWaterCons = waterReading.newMeterEndReading - waterReading.newMeterStartReading;
        }

        waterConsumption = oldWaterCons + newWaterCons;

        if (waterInvoice) {
          waterTotal = waterConsumption * (waterInvoice.m3UnitCost || 0);
        }
      }

      return {
        key,
        month,
        property,
        energy: {
          invoice: energyInvoice,
          reading: energyReading,
          prevReading: prevEnergy?.isReplacement ? prevEnergy.newMeterEndReading : prevEnergy?.currentReading,
          prevBill: prevEnergy,
          consumption: energyConsumption,
          oldConsumption: oldMeterCons,
          newConsumption: newMeterCons,
          total: energyTotal,
          houseFlag,
          houseRefund,
          isReplacement: energyReading?.isReplacement
        },
        water: {
          invoice: waterInvoice,
          reading: waterReading,
          prevReading: prevWater?.isReplacement ? prevWater.newMeterEndReading : prevWater?.currentReading,
          prevBill: prevWater,
          consumption: waterConsumption,
          oldConsumption: oldWaterCons,
          newConsumption: newWaterCons,
          total: waterTotal,
          isReplacement: waterReading?.isReplacement
        },
        grandTotal: energyTotal + waterTotal
      };
    });

    const result = filterMonth ? groups.filter(g => g.month === filterMonth) : groups;
    return result.sort((a,b) => b.month.localeCompare(a.month) || (a.property?.address || '').localeCompare(b.property?.address || ''));
  }, [bills, waterBills, properties, filterMonth, readingsMap, waterReadingsMap]);

  const itemsPerPage = 10;
  const totalPages = Math.ceil(filteredUnifiedGroups.length / itemsPerPage);

  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredUnifiedGroups.slice(start, start + itemsPerPage);
  }, [filteredUnifiedGroups, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMonth]);

  const [deleteModal, setDeleteModal] = useState<{
    show: boolean;
    type: 'energy' | 'water';
    invoiceId?: string;
    readingId?: string;
    propertyAddress?: string;
    month?: string;
  }>({ show: false, type: 'energy' });

  const handleDeleteClick = (type: 'energy' | 'water', group: any) => {
    setDeleteModal({
      show: true,
      type,
      invoiceId: type === 'energy' ? group.energy.invoice?.id : group.water.invoice?.id,
      readingId: type === 'energy' ? group.energy.reading?.id : group.water.reading?.id,
      propertyAddress: group.property?.address || 'Unidade Desconhecida',
      month: group.month
    });
  };



  const handleMeterReadingUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingReading(true);
    setUploadProgress({ current: 0, total: files.length });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i + 1, total: files.length });

        if (!file.type.startsWith('image/')) {
          showToast(`Arquivo ${file.name} ignorado: não é uma imagem.`, 'error');
          continue;
        }

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          // Chama a IA para ler a foto
          const extracted = await aiService.extractMeterReading(base64Data, file.type);
          const property = properties.find(p => p.subMeterId === extracted.meterSerial);

          if (property) {
            const selectedMonth = filterMonth || readingMonth;

            // Verifica duplicata
            const existingReading = bills.find(b =>
              b.propertyId === property.id &&
              b.referenceMonth === selectedMonth &&
              b.currentReading !== undefined
            );

            if (existingReading) {
              if (!window.confirm(`Já existe uma LEITURA para "${property.address}" no mês ${selectedMonth}. Deseja sobrescrever?`)) {
                continue;
              }
              await onDeleteBill(existingReading.id);
            }

            const compressedImage = await compressImage(base64Data);

            const newBill: EnergyBill = {
              id: crypto.randomUUID(),
              fileName: `Leitura_${extracted.meterSerial}_${selectedMonth}.jpg`,
              fileUrl: compressedImage,
              uploadedAt: new Date().toISOString(),
              referenceMonth: selectedMonth,
              propertyId: property.id,
              installationCode: property.mainMeterId,
              meterSerial: extracted.meterSerial,
              currentReading: extracted.currentReading,
              kwhUnitCost: 0,
              flagAdditionalCost: 0,
              refundAmount: 0
            };

            await onAddBill(newBill);
          } else {
            showToast(`Medidor ${extracted.meterSerial} (da foto ${file.name}) não encontrado.`, 'error');
          }
        } catch (error) {
          console.error(`Erro ao processar ${file.name}:`, error);
          showToast(`Erro ao processar foto ${file.name}.`, 'error');
        }
      }
      showToast("Processamento de fotos concluído!", 'success');
    } catch (error) {
      console.error(error);
      showToast("Erro no lote de upload.", 'error');
    } finally {
      setIsProcessingReading(false);
      setUploadProgress(null);
      if (meterInputRef.current) meterInputRef.current.value = '';
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadProgress({ current: 0, total: files.length });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i + 1, total: files.length });

        if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
          showToast(`Arquivo ${file.name} ignorado: não é um PDF ou Imagem.`, 'error');
          continue;
        }

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          const extractedData = await aiService.extractBillData(base64Data, file.type);
          const matchingProperties = properties.filter(p => p.mainMeterId === extractedData.installationCode);

          if (matchingProperties.length > 0) {
            for (const prop of matchingProperties) {
              const refMonth = filterMonth || extractedData.referenceMonth || 'N/A';

              // Verifica duplicata de FATURA (sem leitura atual)
              const existingInvoice = bills.find(b =>
                b.propertyId === prop.id &&
                b.referenceMonth === refMonth &&
                b.currentReading === undefined
              );

              if (existingInvoice) {
                if (!window.confirm(`Já existe uma FATURA para "${prop.address}" no mês ${refMonth}. Deseja sobrescrever?`)) {
                  continue;
                }
                await onDeleteBill(existingInvoice.id);
              }

              const newBill: EnergyBill = {
                id: crypto.randomUUID(),
                fileName: file.name,
                fileUrl: base64Data,
                uploadedAt: new Date().toISOString(),
                referenceMonth: filterMonth || extractedData.referenceMonth || 'N/A',
                installationCode: extractedData.installationCode || '',
                propertyId: prop.id,
                kwhUnitCost: extractedData.kwhUnitCost || 0,
                flagAdditionalCost: extractedData.flagAdditionalCost || 0,
                refundAmount: extractedData.refundAmount || 0,
                masterConsumption: extractedData.masterConsumption || 0,
                hasContent: base64Data.length > 1000
              };
              await onAddBill(newBill);
            }
          } else {
            const newBill: EnergyBill = {
              id: crypto.randomUUID(),
              fileName: file.name,
              fileUrl: base64Data,
              uploadedAt: new Date().toISOString(),
              referenceMonth: filterMonth || extractedData.referenceMonth || 'N/A',
              installationCode: extractedData.installationCode || '',
              kwhUnitCost: extractedData.kwhUnitCost || 0,
              flagAdditionalCost: extractedData.flagAdditionalCost || 0,
              refundAmount: extractedData.refundAmount || 0,
              masterConsumption: extractedData.masterConsumption || 0,
              hasContent: base64Data.length > 1000
            };
            await onAddBill(newBill);
          }
        } catch (error) {
          console.error(`Erro ao processar PDF ${file.name}:`, error);
          showToast(`Erro ao processar fatura ${file.name}.`, 'error');
        }
      }
      showToast("Processamento de PDFs concluído!", 'success');
    } catch (error) {
      console.error(error);
      showToast("Erro no lote de upload.", 'error');
    } finally {
      setIsProcessing(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUnifiedFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsClassifying(true);

    try {
      const dtEnergyBills = new DataTransfer();
      const dtWaterBills = new DataTransfer();
      const dtEnergyMeters = new DataTransfer();
      const dtWaterMeters = new DataTransfer();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
          showToast(`Arquivo ${file.name} ignorado: formato não é PDF ou Imagem.`, 'error');
          continue;
        }

        setClassificationMessage(`Classificando arquivo ${i + 1} de ${files.length}...`);

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const result = await aiService.classifyDocument(base64Data, file.type);
        
        const typeLabels: Record<string, string> = {
          'energy_bill': 'Fatura de Energia',
          'water_bill': 'Fatura de Água',
          'energy_meter': 'Leitura de Energia',
          'water_meter': 'Leitura de Água',
          'pdv': 'Foto de PDV'
        };
        
        const typeLabel = typeLabels[result.type] || 'Documento Desconhecido';
        setClassificationMessage(`Identificado ${file.name} como: ${typeLabel}`);
        
        if (result.type === 'energy_bill') dtEnergyBills.items.add(file);
        else if (result.type === 'water_bill') dtWaterBills.items.add(file);
        else if (result.type === 'energy_meter') dtEnergyMeters.items.add(file);
        else if (result.type === 'water_meter') dtWaterMeters.items.add(file);
      }

      setClassificationMessage(`Processando lotes classificados...`);

      // Roteamento Automático (Simula o comportamento dos botões originais em lote)
      if (dtEnergyBills.files.length > 0) {
        if (fileInputRef.current) fileInputRef.current.files = dtEnergyBills.files;
        await handleFileChange({ target: { files: dtEnergyBills.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
      }
      if (dtWaterBills.files.length > 0) {
        if (waterFileInputRef.current) waterFileInputRef.current.files = dtWaterBills.files;
        await handleWaterFileChange({ target: { files: dtWaterBills.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
      }
      if (dtEnergyMeters.files.length > 0) {
        if (meterInputRef.current) meterInputRef.current.files = dtEnergyMeters.files;
        await handleMeterReadingUpload({ target: { files: dtEnergyMeters.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
      }
      if (dtWaterMeters.files.length > 0) {
        if (waterMeterInputRef.current) waterMeterInputRef.current.files = dtWaterMeters.files;
        await handleWaterMeterReadingUpload({ target: { files: dtWaterMeters.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
      }

      // Limpa a mensagem após 4 segundos (faz sumir)
      setTimeout(() => {
        setClassificationMessage(null);
      }, 4000);

    } catch (error) {
      console.error(error);
      showToast("Erro ao processar lote na IA.", 'error');
    } finally {
      setIsClassifying(false);
      if (unifiedFileInputRef.current) unifiedFileInputRef.current.value = '';
    }
  };

  const handleOpenFile = (fileUrl: string) => {
    // Converte Data URL para Blob para abrir corretamente em nova aba sem bloqueios de segurança
    fetch(fileUrl)
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      })
      .catch((err) => {
        console.error("Erro ao abrir arquivo:", err);
        // Fallback: tenta abrir iframe
        const win = window.open();
        if (win) {
          win.document.write(
            `<iframe src="${fileUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`
          );
        }
      });
  };

  const startEditing = (bill: EnergyBill) => {
    setEditingId(bill.id);
    setEditValue(bill.currentReading?.toString() || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
  };

  const generateReadingPDF = async (group: any, prevReadingBill?: EnergyBill) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = 25;

    // --- Profissional Header & Border ---
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.5);
    doc.line(margin, 12, pageWidth - margin, 12); // Top line

    // --- Title ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(30, 41, 59); // slate-800
    const title = "Relatório de Consumo de Energia";
    const titleWidth = doc.getTextWidth(title);
    doc.text(title, (pageWidth - titleWidth) / 2, y);
    y += 12;

    // --- Subtitle (Tenant Name & Reference) ---
    const tenant = tenants.find(t => t.id === group.property?.tenantId);
    const tenantName = tenant ? tenant.name : (group.property?.address || 'Unidade');

    // Formatar Mês (YYYY-MM -> Mês / YYYY)
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const refMonth = group.invoice?.referenceMonth || group.reading?.referenceMonth || '';
    let formattedRef = refMonth;
    if (refMonth.includes('-')) {
      const [year, month] = refMonth.split('-');
      formattedRef = `${monthNames[parseInt(month) - 1]} / ${year}`;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(71, 85, 105); // slate-600

    // Nome do Inquilino centralizado
    const line1 = tenantName;
    doc.text(line1, (pageWidth - doc.getTextWidth(line1)) / 2, y);
    y += 8;

    // Referência centralizada na linha de baixo
    const line2 = `Referência: ${formattedRef}`;
    doc.text(line2, (pageWidth - doc.getTextWidth(line2)) / 2, y);
    y += 15;

    // --- Photos Section (Before/After) ---
    // --- Photos Section (Before/After) ---
    // Fetch images on demand if not present (due to optimization)
    let prevFileUrl = prevReadingBill?.fileUrl;
    if (!prevFileUrl && prevReadingBill?.hasContent) {
      prevFileUrl = await db.getEnergyBillContent(prevReadingBill.id) || undefined;
    }

    let currentFileUrl = group.reading?.fileUrl;
    if (!currentFileUrl && group.reading?.hasContent) {
      currentFileUrl = await db.getEnergyBillContent(group.reading.id) || undefined;
    }

    if (prevFileUrl || currentFileUrl) {
      const imgWidth = 75;
      const imgHeight = 90;
      const spacing = 10;
      const totalWidth = prevFileUrl && currentFileUrl
        ? (imgWidth * 2) + spacing
        : imgWidth;

      const startX = (pageWidth - totalWidth) / 2;

      // Labels Background
      doc.setFillColor(248, 250, 252); // slate-50

      if (prevFileUrl) {
        doc.setFillColor(30, 41, 59); // slate-800
        doc.roundedRect(startX, y, imgWidth, 8, 2, 2, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(56, 189, 248); // sky-400 (light blue)
        doc.text("LEITURA ANTERIOR", startX + (imgWidth / 2), y + 6, { align: 'center' });
        doc.addImage(prevFileUrl, 'JPEG', startX, y + 10, imgWidth, imgHeight);
      }

      if (currentFileUrl) {
        const nextX = prevFileUrl ? startX + imgWidth + spacing : startX;
        doc.setFillColor(30, 41, 59); // slate-800
        doc.roundedRect(nextX, y, imgWidth, 8, 2, 2, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(56, 189, 248); // sky-400 (light blue)
        doc.text("LEITURA ATUAL", nextX + (imgWidth / 2), y + 6, { align: 'center' });
        doc.addImage(currentFileUrl, 'JPEG', nextX, y + 10, imgWidth, imgHeight);
      }
      y += 115;
    }

    // --- Breakout Box ---
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, pageWidth - (margin * 2), 75, 3, 3, "F");
    y += 12;

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    const detailTitle = "Detalhamento de Valores";
    const detailTitleWidth = doc.getTextWidth(detailTitle);
    doc.text(detailTitle, (pageWidth - detailTitleWidth) / 2, y);
    y += 10;

    // Data Logic
    const kwhCost = group.invoice?.kwhUnitCost || 0;
    const flagCost = group.invoice?.flagAdditionalCost || 0;
    const refund = group.invoice?.refundAmount || 0; // Assuming refund is available here
    const masterkWh = group.invoice?.masterConsumption || 0;
    const flagPerkWh = (masterkWh > 0 && flagCost > 0) ? (flagCost / masterkWh) : 0;
    const refundPerkWh = (masterkWh > 0 && refund > 0) ? (refund / masterkWh) : 0;

    const curR = group.reading?.currentReading || 0;
    const preR = prevReadingBill?.currentReading || 0;
    const consumptionDiff = curR - preR;

    const houseFlagShare = consumptionDiff * flagPerkWh;
    const houseRefundShare = consumptionDiff * refundPerkWh;
    const baseConsumptionCost = consumptionDiff * kwhCost;
    const totalFinal = baseConsumptionCost + houseFlagShare - houseRefundShare;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);

    const details = [
      ["Índice Medidor Anterior:", preR.toString()],
      ["Índice Medidor Atual:", curR.toString()],
      ["Consumo Período:", `${consumptionDiff} kWh`],
      ["Preço Energia (kWh):", `R$ ${kwhCost.toFixed(5).replace('.', ',')}`],
      ["Tarifa bandeira:", `R$ ${houseFlagShare.toFixed(2).replace('.', ',')}`],
      ["Rateio de Devoluções:", `R$ ${houseRefundShare.toFixed(2).replace('.', ',')}`],
    ];

    details.forEach(([label, value]) => {
      doc.text(label, margin + 10, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(value, pageWidth - margin - 15, y, { align: 'right' });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      y += 7;
    });

    // --- Divider ---
    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin + 10, y, pageWidth - margin - 10, y);
    y += 8;

    // --- Total ---
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("VALOR TOTAL A PAGAR:", margin + 10, y);
    doc.setTextColor(126, 34, 206); // purple-700
    doc.text(`R$ ${totalFinal.toFixed(2).replace('.', ',')}`, pageWidth - margin - 15, y, { align: 'right' });

    // --- Footer ---
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(148, 163, 184); // slate-400
    const footer = "Este documento é um relatório gerado automaticamente pelo sistema com base nas fotos dos medidores.";
    doc.text(footer, pageWidth / 2, 285, { align: 'center' });

    doc.save(`Relatorio_${tenantName.replace(/\s+/g, '_')}_${group.reading?.referenceMonth}.pdf`);
  };

  const generateWaterReadingPDF = async (group: any, prevReadingBill?: WaterBill) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = 25;

    // --- Profissional Header & Border ---
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.5);
    doc.line(margin, 12, pageWidth - margin, 12); // Top line

    // --- Title ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(30, 41, 59); // slate-800
    const title = "Relatório de Consumo de Água";
    const titleWidth = doc.getTextWidth(title);
    doc.text(title, (pageWidth - titleWidth) / 2, y);
    y += 12;

    // --- Subtitle (Tenant Name & Reference) ---
    const tenant = tenants.find(t => t.id === group.property?.tenantId);
    const tenantName = tenant ? tenant.name : (group.property?.address || 'Unidade');

    // Formatar Mês (YYYY-MM -> Mês / YYYY)
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const refMonth = group.invoice?.referenceMonth || group.reading?.referenceMonth || '';
    let formattedRef = refMonth;
    if (refMonth.includes('-')) {
      const [year, month] = refMonth.split('-');
      formattedRef = `${monthNames[parseInt(month) - 1]} / ${year}`;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(71, 85, 105); // slate-600

    // Nome do Inquilino centralizado
    const line1 = tenantName;
    doc.text(line1, (pageWidth - doc.getTextWidth(line1)) / 2, y);
    y += 8;

    // Referência centralizada na linha de baixo
    const line2 = `Referência: ${formattedRef}`;
    doc.text(line2, (pageWidth - doc.getTextWidth(line2)) / 2, y);
    y += 15;

    // --- Photos Section (Before/After) ---
    let prevFileUrl = prevReadingBill?.fileUrl;
    if (!prevFileUrl && prevReadingBill?.hasContent) {
      prevFileUrl = await db.getWaterBillContent(prevReadingBill.id) || undefined;
    }

    let currentFileUrl = group.reading?.fileUrl;
    if (!currentFileUrl && group.reading?.hasContent) {
      currentFileUrl = await db.getWaterBillContent(group.reading.id) || undefined;
    }

    if (prevFileUrl || currentFileUrl) {
      const imgWidth = 75;
      const imgHeight = 90;
      const spacing = 10;
      const totalWidth = prevFileUrl && currentFileUrl
        ? (imgWidth * 2) + spacing
        : imgWidth;

      const startX = (pageWidth - totalWidth) / 2;

      doc.setFillColor(248, 250, 252); // slate-50

      if (prevFileUrl) {
        doc.setFillColor(30, 41, 59); // slate-800
        doc.roundedRect(startX, y, imgWidth, 8, 2, 2, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(56, 189, 248); // sky-400 (light blue)
        doc.text("LEITURA ANTERIOR", startX + (imgWidth / 2), y + 6, { align: 'center' });
        doc.addImage(prevFileUrl, 'JPEG', startX, y + 10, imgWidth, imgHeight);
      }

      if (currentFileUrl) {
        const nextX = prevFileUrl ? startX + imgWidth + spacing : startX;
        doc.setFillColor(30, 41, 59); // slate-800
        doc.roundedRect(nextX, y, imgWidth, 8, 2, 2, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(56, 189, 248); // sky-400 (light blue)
        doc.text("LEITURA ATUAL", nextX + (imgWidth / 2), y + 6, { align: 'center' });
        doc.addImage(currentFileUrl, 'JPEG', nextX, y + 10, imgWidth, imgHeight);
      }
      y += 115;
    }

    // --- Breakout Box ---
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, pageWidth - (margin * 2), 75, 3, 3, "F");
    y += 12;

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    const detailTitle = "Detalhamento de Valores";
    const detailTitleWidth = doc.getTextWidth(detailTitle);
    doc.text(detailTitle, (pageWidth - detailTitleWidth) / 2, y);
    y += 10;

    // Data Logic
    const m3Cost = group.invoice?.m3UnitCost || 0;

    // Leitura Manual
    const curR = group.reading?.currentReading || 0;
    const preR = prevReadingBill?.currentReading || 0;

    // Se tiver diferença calculada pela leitura visual:
    let consumptionDiff = 0;
    if (group.reading?.currentReading !== undefined && prevReadingBill?.currentReading !== undefined) {
      consumptionDiff = curR - preR;
    } else {
      // Fallback apenas para não zerar se for só PDF (mas user pediu -)
      // Se estamos gerando relatório de LEITURA, assumimos que tem leitura. 
      // Se não tiver, consumptionDiff fica 0.
    }

    const baseConsumptionCost = consumptionDiff * m3Cost;
    const totalFinal = baseConsumptionCost;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);

    const details = [
      ["Índice Medidor Anterior:", preR.toFixed(3).replace('.', ',')],
      ["Índice Medidor Atual:", curR.toFixed(3).replace('.', ',')],
      ["Consumo Período:", `${consumptionDiff.toFixed(3).replace('.', ',')} m³`],
      ["Custo por m³:", `R$ ${m3Cost.toFixed(2).replace('.', ',')}`],
      [" Outros:", `R$ 0,00`], // Placeholder para alinhar visualmente ou futuro
      ["", ""]
    ];

    details.forEach(([label, value]) => {
      if (!label) { y += 7; return; }
      doc.text(label, margin + 10, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(value, pageWidth - margin - 15, y, { align: 'right' });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      y += 7;
    });

    // --- Divider ---
    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin + 10, y, pageWidth - margin - 10, y);
    y += 8;

    // --- Total ---
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("VALOR TOTAL A PAGAR:", margin + 10, y);
    doc.setTextColor(126, 34, 206); // purple-700
    doc.text(`R$ ${totalFinal.toFixed(2).replace('.', ',')}`, pageWidth - margin - 15, y, { align: 'right' });

    // --- Footer ---
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(148, 163, 184); // slate-400
    const footer = "Este documento é um relatório gerado automaticamente pelo sistema com base nas fotos dos medidores.";
    doc.text(footer, pageWidth / 2, 285, { align: 'center' });

    doc.save(`Relatorio_Agua_${tenantName.replace(/\s+/g, '_')}_${group.reading?.referenceMonth}.pdf`);
  };


  // --- Professional Receipt Helpers ---
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

    if (t === 1) {
      parts.push(teens[u]);
    } else {
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
      } else {
        result += numberToWordsPt(integerPart);
      }
      result += integerPart === 1 ? ' real' : ' reais';
    }

    if (decimalPart > 0) {
      if (result) result += ' e ';
      result += numberToWordsPt(decimalPart) + (decimalPart === 1 ? ' centavo' : ' centavos');
    }

    return result;
  };

  const createProfessionalReceiptPDF = async (group: any, description: string, total: number) => {
    const doc = new jsPDF({ orientation: 'landscape', format: 'a5' });
    const pageWidth = doc.internal.pageSize.getWidth(); // ~210mm
    const pageHeight = doc.internal.pageSize.getHeight(); // ~148mm
    const margin = 12;

    const primaryColor = [30, 41, 59];
    const accentColor = [59, 130, 246];
    const lightGray = [248, 250, 252];
    const darkGray = [71, 85, 105];

    // --- Compact Header ---
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, pageWidth, 35, 'F');

    // Decorative vertical bar (Fixed alignment)
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, 6, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("RECIBO", margin + 8, 22);

    // Branding removed from here as per user request (Rogério Marcos Boitto)

    const tenant = tenants.find((t: any) => {
      if (t.propertyId !== group.property?.id) return false;
      const refDate = new Date(group.month + '-10');
      const entry = t.entryDate ? new Date(t.entryDate) : null;
      const exit = t.exitDate ? new Date(t.exitDate) : null;
      if (entry && refDate < entry) return false;
      if (exit && refDate > exit) return false;
      return true;
    }) || tenants.find((t: any) => t.id === group.property?.tenantId);

    const tenantName = tenant ? tenant.name : (group.property?.address || 'Inquilino');
    const valorExtenso = formatCurrencyPtExtenso(total);

    // --- Side-by-Side Data Row ---
    let y = 45;
    const colWidth = (pageWidth - (margin * 2) - 10) / 2;

    // Column 1: Pagador
    doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.roundedRect(margin, y, colWidth, 22, 2, 2, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text("PAGADOR", margin + 4, y + 6);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFontSize(11);
    const splitTenant = doc.splitTextToSize(tenantName.toUpperCase(), colWidth - 8);
    doc.text(splitTenant, margin + 4, y + 13);

    // Column 2: Total Highlight
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.roundedRect(margin + colWidth + 10, y, colWidth, 22, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text("TOTAL PAGO", margin + colWidth + 14, y + 6);
    doc.setFontSize(16);
    doc.text(`R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin + colWidth + 14, y + 15);

    y += 32;

    // --- Compressed Table Section ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text("DETALHAMENTO", margin, y);
    y += 4;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.1);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFontSize(9);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.text("Item", margin + 4, y);
    doc.text("Referência", pageWidth / 2, y, { align: 'center' });
    doc.text("Valor", pageWidth - margin - 4, y, { align: 'right' });

    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);

    const items = [];

    // Aluguel Month Calculation (Next Month)
    let rentRef = group.month;
    if (group.month && group.month.includes('-')) {
      const [year, month] = group.month.split('-').map(Number);
      const nextDate = new Date(year, month, 1);
      const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      rentRef = `${monthNames[nextDate.getMonth()]} / ${nextDate.getFullYear()}`;
    }

    // Format Utilities Ref
    let utilsRef = group.month;
    if (group.month && group.month.includes('-')) {
      const [year, month] = group.month.split('-').map(Number);
      const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      utilsRef = `${monthNames[month - 1]} / ${year}`;
    }

    if (group.property?.baseRent) {
      items.push({ name: 'Aluguel', ref: rentRef, val: group.property.baseRent });
    }

    const energyVal = group.energy?.total || 0;
    const waterVal = group.water?.total || 0;
    if (energyVal > 0 || waterVal > 0) {
      items.push({ name: 'Energia / Água', ref: utilsRef, val: energyVal + waterVal });
    }

    items.forEach(item => {
      doc.text(item.name, margin + 4, y);
      doc.text(item.ref, pageWidth / 2, y, { align: 'center' });
      doc.text(`R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, pageWidth - margin - 4, y, { align: 'right' });
      y += 6;
    });

    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // --- Footer Area ---
    // Extenso
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    const splitExtenso = doc.splitTextToSize(`Valor por extenso: ${valorExtenso}.`, pageWidth - (margin * 2));
    doc.text(splitExtenso, margin, y);

    y = pageHeight - 18;

    const today = new Date();
    const dateStr = `${today.getDate()} de ${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][today.getMonth()]} de ${today.getFullYear()}`;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(`Salto, ${dateStr}`, margin, y);

    // --- Personalized Issuer Info ---
    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setLineWidth(0.2);
    doc.line(pageWidth - margin - 70, y - 8, pageWidth - margin, y - 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Rogério Marcos Boitto", pageWidth - margin - 35, y - 4, { align: 'center' });
    doc.setFontSize(8);
    doc.text("160.024.608-70", pageWidth - margin - 35, y, { align: 'center' });

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("Pelo Emitente", pageWidth - margin - 35, y + 4, { align: 'center' });

    return { doc, tenantName };
  };

  // Helper para gerar o DOC do PDF (sem salvar)
  const createUnifiedPDFDoc = async (group: any) => {
    // Carregamento paralelo das imagens para evitar lentidão
    const imageUrls = [
      group.energy.prevBill?.fileUrl,
      group.energy.reading?.fileUrl,
      group.energy.reading?.newMeterStartPhotoUrl,
      group.energy.reading?.newMeterEndPhotoUrl,
      group.water.prevBill?.fileUrl,
      group.water.reading?.fileUrl,
      group.water.reading?.newMeterStartPhotoUrl,
      group.water.reading?.newMeterEndPhotoUrl
    ].filter(url => url && typeof url === 'string');

    // "Esquenta" o cache em paralelo
    if (imageUrls.length > 0) {
      await Promise.allSettled(imageUrls.map(url => imageUrlToBase64(url)));
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 15;

    // --- HEADER ---
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 45, "F");

    const tenant = tenants.find(t => {
      const refDate = new Date(group.month + '-10');
      if (t.propertyId !== group.property?.id) return false;
      const entry = t.entryDate ? new Date(t.entryDate) : null;
      const exit = t.exitDate ? new Date(t.exitDate) : null;
      if (entry && refDate < entry) return false;
      if (exit && refDate > exit) return false;
      return true;
    }) || tenants.find(t => t.id === group.property?.tenantId);

    const tenantName = tenant ? tenant.name : (group.property?.nickname || group.property?.address || "Inquilino");
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    let formattedRef = group.month;
    if (group.month.includes('-')) {
      const [year, month] = group.month.split('-');
      formattedRef = `${monthNames[parseInt(month) - 1]} / ${year}`;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    const title = "Relatório de Consumo de Energia e Água";
    doc.text(title, pageWidth / 2, 20, { align: 'center' });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(226, 232, 240); // slate-200
    doc.text(tenantName, pageWidth / 2, 30, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(`Referência: ${formattedRef}`, pageWidth / 2, 37, { align: 'center' });

    y = 50;

    // --- ENERGY SECTION ---
    if (group.energy.invoice || group.energy.reading) {
      doc.setFillColor(240, 249, 255); // sky-50
      doc.setDrawColor(186, 230, 253); // sky-200
      doc.roundedRect(margin, y, pageWidth - (margin * 2), 10, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(2, 132, 199); // sky-600
      doc.text(group.energy.isReplacement ? "ENERGIA ELÉTRICA — TROCA DE MEDIDOR" : "ENERGIA ELÉTRICA", margin + 10, y + 6.5);
      y += 15;

      // Photos Energy
      let prevFileUrl = group.energy.prevBill?.fileUrl;
      if (!prevFileUrl && group.energy.prevBill?.hasContent) {
        prevFileUrl = await db.getEnergyBillContent(group.energy.prevBill.id) || undefined;
      }
      let currentFileUrl = group.energy.reading?.fileUrl;
      if (!currentFileUrl && group.energy.reading?.hasContent) {
        currentFileUrl = await db.getEnergyBillContent(group.energy.reading.id) || undefined;
      }

      let photoH = 0;
      const imgW = 40; const imgH = 50; const gap = 5;
      
      // Foto Anterior
      doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      doc.text("Leitura Anterior", margin, y);
      const b64Prev = prevFileUrl ? await imageUrlToBase64(prevFileUrl) : '';
      if (b64Prev) {
        doc.addImage(b64Prev, 'JPEG', margin, y + 2, imgW, imgH);
      } else {
        doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin, y + 2, imgW, imgH, 1, 1, "FD");
        doc.setFontSize(7); doc.setTextColor(150, 150, 150);
        doc.text("Foto não", margin + imgW/2, y + 2 + imgH/2 - 2, { align: 'center' });
        doc.text("registrada", margin + imgW/2, y + 2 + imgH/2 + 2, { align: 'center' });
      }

      // Foto Atual
      doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      doc.text("Leitura Atual", margin + imgW + gap, y);
      const b64Curr = currentFileUrl ? await imageUrlToBase64(currentFileUrl) : '';
      if (b64Curr) {
        doc.addImage(b64Curr, 'JPEG', margin + imgW + gap, y + 2, imgW, imgH);
      } else {
        doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin + imgW + gap, y + 2, imgW, imgH, 1, 1, "FD");
        doc.setFontSize(7); doc.setTextColor(150, 150, 150);
        doc.text("Foto não", margin + imgW + gap + imgW/2, y + 2 + imgH/2 - 2, { align: 'center' });
        doc.text("registrada", margin + imgW + gap + imgW/2, y + 2 + imgH/2 + 2, { align: 'center' });
      }
      photoH = 55;

      // NOVO MEDIDOR PHOTOS - ENERGY
      let replacementH = 0;
      if (group.energy.isReplacement && group.energy.reading) {
        const re = group.energy.reading;
        const startY = y + (photoH > 0 ? 55 : 0);
        const nsUrl = re.newMeterStartPhotoUrl;
        const neUrl = re.newMeterEndPhotoUrl;

        // Foto Novo Medidor Início
        doc.setFontSize(8); doc.setTextColor(234, 88, 12);
        doc.text("Novo Med. (Início)", margin, startY);
        const b64NS = nsUrl ? await imageUrlToBase64(nsUrl) : '';
        if (b64NS) {
          doc.addImage(b64NS, 'JPEG', margin, startY + 2, imgW, imgH);
        } else {
          doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
          doc.roundedRect(margin, startY + 2, imgW, imgH, 1, 1, "FD");
          doc.setFontSize(7); doc.setTextColor(150, 150, 150);
          doc.text("Foto não", margin + imgW/2, startY + 2 + imgH/2 - 2, { align: 'center' });
          doc.text("registrada", margin + imgW/2, startY + 2 + imgH/2 + 2, { align: 'center' });
        }

        // Foto Novo Medidor Final
        doc.setFontSize(8); doc.setTextColor(234, 88, 12);
        doc.text("Novo Med. (Final)", margin + imgW + gap, startY);
        const b64NE = neUrl ? await imageUrlToBase64(neUrl) : '';
        if (b64NE) {
          doc.addImage(b64NE, 'JPEG', margin + imgW + gap, startY + 2, imgW, imgH);
        } else {
          doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
          doc.roundedRect(margin + imgW + gap, startY + 2, imgW, imgH, 1, 1, "FD");
          doc.setFontSize(7); doc.setTextColor(150, 150, 150);
          doc.text("Foto não", margin + imgW + gap + imgW/2, startY + 2 + imgH/2 - 2, { align: 'center' });
          doc.text("registrada", margin + imgW + gap + imgW/2, startY + 2 + imgH/2 + 2, { align: 'center' });
        }
        replacementH = 55;
      }


      // Energy Data
      const dataX = (prevFileUrl || currentFileUrl) ? margin + 95 : margin;
      let dataY = y + 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85);
      const eLines: string[][] = [];

      if (group.energy.isReplacement && group.energy.reading) {
        const r = group.energy.reading;
        const oldCons = group.energy.oldConsumption || 0;
        const newCons = group.energy.newConsumption || 0;
        eLines.push(
          [`DETALHAMENTO ENERGIA`, ``],
          [`- Novo Código Medidor:`, `${r.meterSerial || '-'}`],
          [`- Medidor Antigo - Anterior:`, `${group.energy.prevReading?.toFixed(0) ?? '-'}`],
          [`- Medidor Antigo - Final:`, `${r.currentReading?.toFixed(0) ?? '-'}`],
          [`- Consumo Med. Antigo:`, `${oldCons.toFixed(0)} kWh`],
          [``, ``],
          [`- Medidor Novo - Início:`, `${r.newMeterStartReading?.toFixed(0) ?? '-'}`],
          [`- Medidor Novo - Final:`, `${r.newMeterEndReading?.toFixed(0) ?? '-'}`],
          [`- Consumo Med. Novo:`, `${newCons.toFixed(0)} kWh`],
          [``, ``],
          [`CONSUMO TOTAL MÊS:`, `${group.energy.consumption?.toFixed(0) ?? 0} kWh`],
          [`Tarifa (kWh):`, `R$ ${group.energy.invoice?.kwhUnitCost?.toFixed(5)?.replace('.', ',') ?? '0,00'}`],
          [`Adicionais (Flag/Luz):`, `R$ ${group.energy.houseFlag?.toFixed(2)?.replace('.', ',') ?? '0,00'}`],
          [`Descontos/Reembolsos:`, `R$ ${group.energy.houseRefund?.toFixed(2)?.replace('.', ',') ?? '0,00'}`],
          [`SUBTOTAL ENERGIA:`, `R$ ${group.energy.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
        );
      } else {
        eLines.push(
          [`Leitura Anterior:`, `${group.energy.prevReading?.toFixed(0) ?? '-'}`],
          [`Leitura Atual:`, `${group.energy.reading?.currentReading?.toFixed(0) ?? '-'}`],
          [`Consumo Total:`, `${group.energy.consumption?.toFixed(0) ?? 0} kWh`],
          [`Tarifa (kWh):`, `R$ ${group.energy.invoice?.kwhUnitCost?.toFixed(5)?.replace('.', ',') ?? '0,00'}`],
          [`Subtotal Energia:`, `R$ ${group.energy.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
        );
      }

      eLines.forEach(([label, value]) => {
        doc.text(label, dataX, dataY);
        doc.setFont("helvetica", "bold");
        doc.text(value, pageWidth - margin - 5, dataY, { align: 'right' });
        doc.setFont("helvetica", "normal");
        dataY += 7;
      });

      if (group.energy.isReplacement) {
        doc.setFontSize(8); doc.setTextColor(100);
        doc.setFont("helvetica", "italic");
        doc.text("* Nota: Houve a troca do medidor este mês. O consumo total é a soma do medidor antigo e do novo.", dataX, dataY);
        dataY += 8;
      }

      y = Math.max(y + photoH + replacementH + 5, dataY + 10);
    }

    // --- WATER SECTION ---
    if (group.water.invoice || group.water.reading) {
      if (y > pageHeight - 100) { doc.addPage(); y = 20; }
      doc.setFillColor(236, 253, 245); // emerald-50
      doc.setDrawColor(167, 243, 208); // emerald-200
      doc.roundedRect(margin, y, pageWidth - (margin * 2), 10, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(5, 150, 105); // emerald-600
      doc.text(group.water.isReplacement ? "ÁGUA & ESGOTO — TROCA DE MEDIDOR" : "ÁGUA & ESGOTO", margin + 10, y + 6.5);
      y += 15;

      let pwUrl = group.water.prevBill?.fileUrl;
      if (!pwUrl && group.water.prevBill?.hasContent) {
        pwUrl = await db.getWaterBillContent(group.water.prevBill.id) || undefined;
      }
      let cwUrl = group.water.reading?.fileUrl;
      if (!cwUrl && group.water.reading?.hasContent) {
        cwUrl = await db.getWaterBillContent(group.water.reading.id) || undefined;
      }

      let wPhotoH = 0;
      const imgW = 40; const imgH = 50; const gap = 5;

      // Foto Anterior Água
      doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      doc.text("Leitura Anterior", margin, y);
      const b64WPrev = pwUrl ? await imageUrlToBase64(pwUrl) : '';
      if (b64WPrev) {
        doc.addImage(b64WPrev, 'JPEG', margin, y + 2, imgW, imgH);
      } else {
        doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin, y + 2, imgW, imgH, 1, 1, "FD");
        doc.setFontSize(7); doc.setTextColor(150, 150, 150);
        doc.text("Foto não", margin + imgW/2, y + 2 + imgH/2 - 2, { align: 'center' });
        doc.text("registrada", margin + imgW/2, y + 2 + imgH/2 + 2, { align: 'center' });
      }

      // Foto Atual Água
      doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      doc.text("Leitura Atual", margin + imgW + gap, y);
      const b64WCurr = cwUrl ? await imageUrlToBase64(cwUrl) : '';
      if (b64WCurr) {
        doc.addImage(b64WCurr, 'JPEG', margin + imgW + gap, y + 2, imgW, imgH);
      } else {
        doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin + imgW + gap, y + 2, imgW, imgH, 1, 1, "FD");
        doc.setFontSize(7); doc.setTextColor(150, 150, 150);
        doc.text("Foto não", margin + imgW + gap + imgW/2, y + 2 + imgH/2 - 2, { align: 'center' });
        doc.text("registrada", margin + imgW + gap + imgW/2, y + 2 + imgH/2 + 2, { align: 'center' });
      }
      wPhotoH = 55;

      // NOVO MEDIDOR PHOTOS - WATER
      let wReplacementH = 0;
      if (group.water.isReplacement && group.water.reading) {
        const rw = group.water.reading;
        const startY = y + (wPhotoH > 0 ? 55 : 0);
        const wnsUrl = rw.newMeterStartPhotoUrl;
        const wneUrl = rw.newMeterEndPhotoUrl;

        // Foto Novo Medidor Início Água
        doc.setFontSize(8); doc.setTextColor(234, 88, 12);
        doc.text("Novo Med. (Início)", margin, startY);
        const b64WNS = wnsUrl ? await imageUrlToBase64(wnsUrl) : '';
        if (b64WNS) {
          doc.addImage(b64WNS, 'JPEG', margin, startY + 2, imgW, imgH);
        } else {
          doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
          doc.roundedRect(margin, startY + 2, imgW, imgH, 1, 1, "FD");
          doc.setFontSize(7); doc.setTextColor(150, 150, 150);
          doc.text("Foto não", margin + imgW/2, startY + 2 + imgH/2 - 2, { align: 'center' });
          doc.text("registrada", margin + imgW/2, startY + 2 + imgH/2 + 2, { align: 'center' });
        }

        // Foto Novo Medidor Final Água
        doc.setFontSize(8); doc.setTextColor(234, 88, 12);
        doc.text("Novo Med. (Final)", margin + imgW + gap, startY);
        const b64WNE = wneUrl ? await imageUrlToBase64(wneUrl) : '';
        if (b64WNE) {
          doc.addImage(b64WNE, 'JPEG', margin + imgW + gap, startY + 2, imgW, imgH);
        } else {
          doc.setDrawColor(200, 200, 200); doc.setFillColor(245, 245, 245);
          doc.roundedRect(margin + imgW + gap, startY + 2, imgW, imgH, 1, 1, "FD");
          doc.setFontSize(7); doc.setTextColor(150, 150, 150);
          doc.text("Foto não", margin + imgW + gap + imgW/2, startY + 2 + imgH/2 - 2, { align: 'center' });
          doc.text("registrada", margin + imgW + gap + imgW/2, startY + 2 + imgH/2 + 2, { align: 'center' });
        }
        wReplacementH = 55;
      }


      const wDataX = (pwUrl || cwUrl) ? margin + 95 : margin;
      let wDataY = y + 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85);
      const wLines: string[][] = [];

      if (group.water.isReplacement && group.water.reading) {
        const r = group.water.reading;
        const oldCons = group.water.oldConsumption || 0;
        const newCons = group.water.newConsumption || 0;
        wLines.push(
          [`DETALHAMENTO ÁGUA`, ``],
          [`- Novo Código Medidor:`, `${r.meterSerial || '-'}`],
          [`- Medidor Antigo - Anterior:`, `${group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`- Medidor Antigo - Final:`, `${r.currentReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`- Consumo Med. Antigo:`, `${oldCons.toFixed(3).replace('.', ',')} m³`],
          [``, ``],
          [`- Medidor Novo - Início:`, `${r.newMeterStartReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`- Medidor Novo - Final:`, `${r.newMeterEndReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`- Consumo Med. Novo:`, `${newCons.toFixed(3).replace('.', ',')} m³`],
          [``, ``],
          [`CONSUMO TOTAL MÊS:`, `${group.water.consumption?.toFixed(3).replace('.', ',') ?? 0} m³`],
          [`Custo (m³):`, `R$ ${group.water.invoice?.m3UnitCost?.toFixed(2)?.replace('.', ',') ?? '0,00'}`],
          [`SUBTOTAL ÁGUA:`, `R$ ${group.water.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
        );
      } else {
        wLines.push(
          [`Leitura Anterior:`, `${group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`Leitura Atual:`, `${group.water.reading?.currentReading?.toFixed(3).replace('.', ',') ?? '-'}`],
          [`Consumo Total:`, `${group.water.consumption?.toFixed(3).replace('.', ',') ?? 0} m³`],
          [`Custo (m³):`, `R$ ${group.water.invoice?.m3UnitCost?.toFixed(2)?.replace('.', ',') ?? '0,00'}`],
          [`Subtotal Água:`, `R$ ${group.water.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
        );
      }

      wLines.forEach(([label, value]) => {
        doc.text(label, wDataX, wDataY);
        doc.setFont("helvetica", "bold");
        doc.text(value, pageWidth - margin - 5, wDataY, { align: 'right' });
        doc.setFont("helvetica", "normal");
        wDataY += 7;
      });

      if (group.water.isReplacement) {
        doc.setFontSize(8); doc.setTextColor(100);
        doc.setFont("helvetica", "italic");
        doc.text("* Nota: Houve a troca do medidor este mês. O consumo total é a soma do medidor antigo e do novo.", wDataX, wDataY);
        wDataY += 8;
      }

      y = Math.max(y + wPhotoH + wReplacementH + 5, wDataY + 10);
    }

    // --- SUMMARY ---
    if (y > pageHeight - 50) { doc.addPage(); y = 20; }
    y += 5;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, pageWidth - (margin * 2), 30, 3, 3, "FD");

    const tE = group.energy.total || 0;
    const tW = group.water.total || 0;
    const gT = tE + tW;

    doc.setFontSize(11); doc.setTextColor(100);
    doc.text("Energia:", margin + 10, y + 10);
    doc.text("Água:", margin + 10, y + 18);
    doc.setFont("helvetica", "bold"); doc.setTextColor(50);
    doc.text(`R$ ${tE.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 10, { align: 'right' });
    doc.text(`R$ ${tW.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 18, { align: 'right' });

    doc.setFontSize(16); doc.setTextColor(22, 163, 74);
    doc.text("TOTAL:", margin + 10, y + 26);
    doc.text(`R$ ${gT.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 26, { align: 'right' });

    return { doc, tenantName };
  };

  const generateUnifiedPDF = async (group: any) => {
    const { doc, tenantName } = await createUnifiedPDFDoc(group);
    doc.save(`${tenantName}.pdf`);
  };

  const handleSendWhatsapp = async (group: any) => {
    // Histórico de Inquilinos: Busca o inquilino ativo no mês de referência
    const refDate = new Date(group.month + '-10');
    const tenant = tenants.find(t => {
      if (t.propertyId !== group.property?.id) return false;
      const entry = t.entryDate ? new Date(t.entryDate) : null;
      const exit = t.exitDate ? new Date(t.exitDate) : null;
      if (entry && refDate < entry) return false;
      if (exit && refDate > exit) return false;
      return true;
    }) || tenants.find(t => t.id === group.property?.tenantId);

    if (!tenant || !tenant.phone) {
      showToast("Telefone do inquilino não encontrado.", "error");
      return;
    }

    const phone = tenant.phone.replace(/\D/g, '');
    const message = `Olá ${tenant.name}, segue o relatório unificado de contas do mês de ${group.month}.`;

    // Detect if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Try Web Share API with File (Mobile Only)
    if (isMobile && navigator.share && navigator.canShare) {
      try {
        showToast("Gerando relatório para envio...", "info");
        const { doc, tenantName } = await createUnifiedPDFDoc(group);
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], `${tenantName}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Relatório Unificado',
            text: message,
          });
          return;
        }
      } catch (error) {
        console.error("Erro no compartilhamento nativo:", error);
        // Fallback to link if share fails/cancelled
      }
    }

    // Fallback: Download + Open WhatsApp
    showToast("Baixando relatório... Por favor, anexe-o manualmente no WhatsApp.", "info");
    await generateUnifiedPDF(group); // Triggers download

    // Small delay to ensure download starts before tab switch
    setTimeout(() => {
      const url = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    }, 1000);
  };


  const saveReading = async (billId: string) => {
    const newVal = parseFloat(editValue);
    if (isNaN(newVal)) {
      showToast("Valor inválido.", 'error');
      return;
    }

    try {
      await db.updateEnergyBill(billId, { currentReading: newVal });

      // Otimista: atualiza local se possível, mas o ideal seria reload
      // Como o App.tsx controla bills, talvez fosse melhor passar um onUpdateBill.
      // Mas para manter simples e consistente, vamos recarregar tudo via fake add ou refresh
    } catch (error) {
      console.error(error);
      showToast("Erro ao atualizar leitura.", 'error');
    }
    setEditingId(null);
  };

  /* --- HANDLERS --- */

  const handleViewBill = async (bill: EnergyBill | WaterBill, type: 'energy' | 'water') => {
    let fileUrl = bill.fileUrl;

    // Se não tem URL, mas o flag hasContent indica que deve haver conteúdo separado
    if (!fileUrl) {
      if (type === 'energy') {
        fileUrl = await db.getEnergyBillContent(bill.id) || undefined;
      } else {
        fileUrl = await db.getWaterBillContent(bill.id) || undefined;
      }
    }

    if (fileUrl) {
      // Se for um Data URL (Base64), converte para Blob para melhor suporte em navegadores
      if (fileUrl.startsWith('data:')) {
        try {
          const res = await fetch(fileUrl);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank');
        } catch (e) {
          console.error("Erro ao abrir Base64:", e);
          // Fallback para o método antigo se falhar
          const win = window.open();
          win?.document.write(`<iframe src="${fileUrl}" frameborder="0" style="width:100%; height:100%;" allowfullscreen></iframe>`);
        }
      } else {
        // Se for uma URL direta (Storage), abre direto
        window.open(fileUrl, '_blank');
      }
    } else {
      showToast("Arquivo da fatura não encontrado no servidor.", "error");
    }
  };

  const handleMouseEnterBill = async (e: React.MouseEvent, bill: EnergyBill | WaterBill, type: 'energy' | 'water', side: 'left' | 'right' = 'right') => {
    const x = e.clientX;
    const y = e.clientY;
    
    setHoverPreview({ url: null, x, y, loading: true, side, noContent: false });

    let fileUrl = bill.fileUrl;
    if (!fileUrl && bill.hasContent) {
      if (type === 'energy') {
        fileUrl = await db.getEnergyBillContent(bill.id) || undefined;
      } else {
        fileUrl = await db.getWaterBillContent(bill.id) || undefined;
      }
    }

    if (fileUrl) {
      setHoverPreview(prev => ({ ...prev, url: fileUrl || null, loading: false }));
    } else {
      setHoverPreview(prev => ({ ...prev, loading: false, noContent: true }));
    }
  };

  const handleMouseMoveBill = (e: React.MouseEvent) => {
    setHoverPreview(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
  };

  const handleMouseLeaveBill = () => {
    setHoverPreview(prev => ({ ...prev, url: null, loading: false, noContent: false }));
  };

  /* --- WATER READING HANDLERS --- */

  const startEditingWater = (reading: WaterBill) => {
    setEditingId(reading.id);
    setEditValue(reading.currentReading?.toString() || '');
  };

  const saveWaterReading = async (readingId: string) => {
    const newVal = parseFloat(editValue);
    if (isNaN(newVal)) {
      showToast("Valor inválido.", 'error');
      return;
    }

    try {
      await db.updateWaterBill(readingId, { currentReading: newVal });
      showToast("Leitura atualizada com sucesso.", 'success');
      // window.location.reload(); // Removido para evitar refresh
    } catch (error) {
      console.error(error);
      showToast("Erro ao atualizar leitura de água.", 'error');
    }
    setEditingId(null);
  };

  const handleWaterFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingWater(true);
    setWaterUploadProgress({ current: 0, total: files.length });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setWaterUploadProgress({ current: i + 1, total: files.length });

        if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
          showToast(`Arquivo ${file.name} ignorado: não é PDF ou Imagem.`, 'error');
          continue;
        }

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          const extractedData = await aiService.extractWaterBillData(base64Data, file.type);

          // CDC extraído (pode conter hífens)
          const rawCDC = extractedData.installationCode || '';

          // Normaliza para busca (apenas números e letras)
          const searchCDC = rawCDC.replace(/[^a-zA-Z0-9]/g, '');

          // Tenta encontrar propriedades pelo CDC (waterMeterId)
          // Considera que várias casas podem compartilhar o mesmo CDC (Hidrômetro Mestre)
          const matchingProperties = properties.filter(p => {
            const propCDC = (p.waterMeterId || '').replace(/[^a-zA-Z0-9]/g, '');
            return propCDC && propCDC === searchCDC;
          });

          if (matchingProperties.length > 0) {
            for (const prop of matchingProperties) {
              const refMonth = filterMonth || extractedData.referenceMonth || 'N/A';

              // Verifica duplicata de FATURA de ÁGUA
              const existingInvoice = waterBills.find(b =>
                b.propertyId === prop.id &&
                b.referenceMonth === refMonth &&
                b.currentReading === undefined
              );

              if (existingInvoice) {
                if (!window.confirm(`Já existe uma FATURA de ÁGUA para "${prop.address}" no mês ${refMonth}. Deseja sobrescrever?`)) {
                  continue;
                }
                await onDeleteWaterBill(existingInvoice.id);
              }

              const newBill: WaterBill = {
                id: generateUUID(),
                fileName: file.name,
                fileUrl: base64Data,
                uploadedAt: new Date().toISOString(),
                referenceMonth: filterMonth || extractedData.referenceMonth || 'N/A',
                installationCode: rawCDC, // Mantém formatação original (ex: 61894-84)
                meterSerial: '', // Não usa serial da fatura (que é do medidor mestre)
                propertyId: prop.id,
                m3UnitCost: extractedData.m3UnitCost || 0,
                totalAmount: extractedData.totalAmount || 0,
                refundAmount: 0,
                masterConsumption: extractedData.masterConsumption || 0,
                hasContent: base64Data.length > 1000,
                // currentReading: extractedData.currentReading // REMOVIDO: Não usar leitura do PDF para Medidor Atual
              };
              await onAddWaterBill(newBill);
            }
            showToast(`Fatura vinculada a ${matchingProperties.length} casas com CDC ${rawCDC}.`, 'success');
          } else {
            // Caso não encontre, salva sem vincular ou vincula genérico
            const newBill: WaterBill = {
              id: crypto.randomUUID(),
              fileName: file.name,
              fileUrl: base64Data,
              uploadedAt: new Date().toISOString(),
              referenceMonth: filterMonth || extractedData.referenceMonth || 'N/A',
              installationCode: rawCDC,
              meterSerial: '', // Não usa serial da fatura
              m3UnitCost: extractedData.m3UnitCost || 0,
              totalAmount: extractedData.totalAmount || 0,
              refundAmount: 0,
              masterConsumption: extractedData.masterConsumption || 0,
              hasContent: base64Data.length > 1000,
              // currentReading: extractedData.currentReading // REMOVIDO: Não usar leitura do PDF para Medidor Atual
            };
            await onAddWaterBill(newBill);
            showToast(`Fatura salva, mas CDC ${rawCDC} não encontrado em nenhuma casa.`, 'info');
          }
        } catch (error) {
          console.error(`Erro ao processar PDF ${file.name}:`, error);
          showToast(`Erro ao processar fatura de água ${file.name}.`, 'error');
        }
      }
      showToast("Processamento de Faturas de Água concluído!", 'success');
    } catch (error) {
      console.error(error);
      showToast("Erro no lote de upload.", 'error');
    } finally {
      setIsProcessingWater(false);
      setWaterUploadProgress(null);
      if (waterFileInputRef.current) waterFileInputRef.current.value = '';
    }
  };

  const handleWaterMeterReadingUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingWaterReading(true);
    setWaterUploadProgress({ current: 0, total: files.length });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setWaterUploadProgress({ current: i + 1, total: files.length });

        if (!file.type.startsWith('image/')) {
          showToast(`Arquivo ${file.name} ignorado: não é uma imagem.`, 'error');
          continue;
        }

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          const extracted = await aiService.extractWaterMeterReading(base64Data, file.type);

          // Lógica de Saneamento: Prioriza blackDigits/redDigits se disponíveis
          let finalReading = extracted.currentReading;
          if (extracted.blackDigits && extracted.redDigits) {
            const reconstructed = parseFloat(`${extracted.blackDigits}.${extracted.redDigits}`);
            // Se a leitura direta for muito maior (ex: 1020 vs 20) e começar com 1, usa a reconstruída
            if (finalReading > reconstructed * 10 && finalReading.toString().startsWith('1')) {
              finalReading = reconstructed;
            } else {
              // Se não houver discrepância absurda, confia na reconstrução que é mais granular
              finalReading = reconstructed;
            }
          }

          // Normaliza serial para comparação (remove espaços e poe em uppercase)
          const extractedSerial = extracted.meterSerial?.trim().toUpperCase();

          // Procura por waterSubMeterId ou waterMeterId com "fuzzy match" (contém)
          const property = properties.find(p => {
            const pSub = p.waterSubMeterId?.trim().toUpperCase();
            const pMain = p.waterMeterId?.trim().toUpperCase();

            if (!extractedSerial) return false;
            if (extractedSerial.length < 3) return false; // Evita match falso com "01"

            // Verifica se um contém o outro (ex: 'A25AK123' match '123' ou '123' match 'A25AK123')
            const matchSub = pSub && (extractedSerial.includes(pSub) || pSub.includes(extractedSerial));
            const matchMain = pMain && (extractedSerial.includes(pMain) || pMain.includes(extractedSerial));

            return matchSub || matchMain;
          });

          if (property) {
            // Verifica duplicata de LEITURA de ÁGUA
            const selectedMonth = filterMonth || readingMonth;
            const existingReading = waterBills.find(b =>
              b.propertyId === property.id &&
              b.referenceMonth === selectedMonth &&
              b.currentReading !== undefined
            );

            if (existingReading) {
              if (!window.confirm(`Já existe uma LEITURA de ÁGUA para "${property.address}" no mês ${selectedMonth}. Deseja sobrescrever?`)) {
                continue;
              }
              await onDeleteWaterBill(existingReading.id);
            }

            const compressedImage = await compressImage(base64Data);
            const newBill: WaterBill = {
              id: crypto.randomUUID(),
              fileName: `Leitura_Agua_${extracted.meterSerial}_${selectedMonth}.jpg`,
              fileUrl: compressedImage,
              uploadedAt: new Date().toISOString(),
              referenceMonth: selectedMonth,
              propertyId: property.id,
              installationCode: property.waterMeterId,
              meterSerial: extracted.meterSerial,
              currentReading: finalReading,
              m3UnitCost: 0
            };
            await onAddWaterBill(newBill);
            showToast(`Leitura salva para: ${property.nickname || property.address} (${finalReading} m³)`, 'success');
          } else {
            console.warn(`Serial extraído: '${extractedSerial}' não bate com nenhuma propriedade.`);
            showToast(`Hidrômetro não cadastrado. Serial lido: "${extracted.meterSerial}". Verifique o cadastro da Casa.`, 'error');
          }
        } catch (error) {
          console.error(`Erro ao processar ${file.name}:`, error);
          showToast(`Erro ao processar foto ${file.name}.`, 'error');
        }
      }
      // showToast("Leituras de Água processadas!", 'success'); // Removido para não sobrepor erro
    } catch (error) {
      showToast("Erro no upload de leituras.", 'error');
    }
  };


  // Handler para criar cobranÃ§a do Asaas
  // Função completa de cobrança para EnergyTab
  const handleChargeFromEnergyTab = async (group: any) => {
    const property = group.property;
    const tenant = property?.tenantId ? tenants.find((t: any) => t.id === property.tenantId) : null;

    if (!tenant) {
      showToast('Esta unidade não possui inquilino vinculado.', 'error');
      return;
    }

    if (!filterMonth) {
      showToast('Selecione um mês para gerar a cobrança.', 'error');
      return;
    }

    const chargeKey = `${tenant.id}-${filterMonth}`;
    if (createdCharges[chargeKey]) {
      const confirmar = window.confirm('Esta cobrança já foi criada. Deseja criar uma nova cobrança?');
      if (!confirmar) return;
    }

    if (!tenant.cpf) {
      showToast(`O inquilino "${tenant.name}" não possui CPF cadastrado.`, 'error');
      return;
    }

    if (!tenant.dueDay) {
      showToast(`O inquilino "${tenant.name}" não possui dia de vencimento configurado.`, 'error');
      return;
    }

    const waterValue = group.water.total || 0;
    const energyValue = group.energy.total || 0;
    const rent = property.baseRent || 0;
    const total = waterValue + energyValue + rent;

    if (total <= 0) {
      showToast('Não há valores para cobrar neste período.', 'error');
      return;
    }

    setLoadingCharge(tenant.id);

    try {
      let customerId = tenant.asaasCustomerId;

      if (!customerId) {
        showToast('Vinculando cliente no Asaas...', 'info');
        const cpfClean = tenant.cpf.replace(/\D/g, '');

        if (!tenant.email && !tenant.phone) {
          showToast(`O inquilino "${tenant.name}" precisa ter email ou telefone cadastrado.`, 'error');
          setLoadingCharge(null);
          return;
        }

        let existingCustomer = await getCustomerByCpf(cpfClean);
        if (existingCustomer) {
          customerId = existingCustomer.id;
          showToast('Cliente encontrado no Asaas!', 'success');
        } else {
          const newCustomer = await createCustomer(
            tenant.name,
            cpfClean,
            tenant.email || `sem-email-${cpfClean}@boitto.app`,
            tenant.phone || ''
          );
          customerId = newCustomer.id;
          showToast('Novo cliente criado no Asaas!', 'success');
        }

        await db.updateTenant(tenant.id, { asaasCustomerId: customerId });
      }

      const dueDate = calculateDueDate(tenant.dueDay, filterMonth);
      const dateObj = new Date(dueDate + 'T12:00:00');
      dateObj.setDate(dateObj.getDate() - 1);
      const limitDate = dateObj.toISOString().split('T')[0];

      const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      const [year, month] = filterMonth.split('-');
      const monthUtilitiesStr = `${monthNames[parseInt(month) - 1]}/${year}`;

      let nextMonth = parseInt(month) + 1;
      let nextYear = parseInt(year);
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
      }
      const monthRentStr = `${monthNames[nextMonth - 1]}/${nextYear}`;

      const description = `Aluguel + Contas\n` +
        `Ref: ${monthUtilitiesStr} (Consumo) / ${monthRentStr} (Aluguel)\n\n` +
        `• Aluguel (${monthRentStr}): R$ ${rent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
        `• Água (${monthUtilitiesStr}): R$ ${waterValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
        `• Energia (${monthUtilitiesStr}): R$ ${energyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
        `Endereço: ${property.address}`;

      const payment = await createPayment({
        customerId,
        dueDate,
        value: total,
        description,
        items: [],
        discount: {
          value: DISCOUNT_VALUE,
          limitDate: limitDate,
          type: 'FIXED'
        }
      });

      const newCreatedCharges = { ...createdCharges, [chargeKey]: payment.id };
      setCreatedCharges(newCreatedCharges);
      localStorage.setItem('asaas-created-charges', JSON.stringify(newCreatedCharges));

      showToast(`Cobrança criada com sucesso! ID: ${payment.id}`, 'success');

      if (payment.invoiceUrl) {
        window.open(payment.invoiceUrl, '_blank');
      }

      // --- Upload do Recibo (Profissional) ---
      try {
        showToast('Gerando recibo profissional e anexando...', 'info');
        const { doc, tenantName } = await createProfessionalReceiptPDF(group, description, total);
        const pdfBase64 = doc.output('datauristring');

        await uploadPaymentDocument(
          payment.id,
          pdfBase64,
          `Recibo_${tenantName}_${filterMonth}.pdf`,
          true
        );
        showToast('Recibo profissional anexado!', 'success');
      } catch (uploadError) {
        console.error('Erro ao anexar recibo:', uploadError);
        showToast('Cobrança criada, mas houve erro ao anexar o recibo.', 'error');
      }
    } catch (error: any) {
      console.error('Erro ao criar cobrança:', error);
      showToast(`Erro ao criar cobrança: ${error.message || 'Erro desconhecido'}`, 'error');
    } finally {
      setLoadingCharge(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in relative transition-all">
      {/* Modal de Seleção de Mês */}
      {showMonthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 transform transition-all scale-100">
            <h3 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
              <Zap className="text-emerald-500" size={20} />
              Nova Leitura de Medidor
            </h3>
            <p className="text-slate-500 text-sm mb-4">
              Informe o mês de referência para esta leitura antes de carregar a foto.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Mês de Referência</label>
                <input
                  type="month"
                  value={readingMonth}
                  onChange={(e) => setReadingMonth(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowMonthModal(false)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setShowMonthModal(false);
                    setTimeout(() => {
                      if (uploadType === 'energy') {
                        if (isCameraMode) energyCameraInputRef.current?.click();
                        else meterInputRef.current?.click();
                      } else {
                        if (isCameraMode) waterCameraInputRef.current?.click();
                        else waterMeterInputRef.current?.click();
                      }
                    }, 100);
                  }}
                  className="flex-1 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg transition-all"
                >
                  Selecionar Foto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Progresso/Status IA (Canto Inferior Direito) */}
      {(isClassifying || classificationMessage) && (
        <div className="fixed bottom-6 right-6 z-[60] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 min-w-[300px] animate-slide-up-fade">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${isClassifying ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {isClassifying ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                </div>
                <span className="text-sm font-bold text-slate-700">
                  {isClassifying ? 'IA Analisando...' : 'Identificação Concluída'}
                </span>
              </div>
              {!isClassifying && (
                <button onClick={() => setClassificationMessage(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              )}
            </div>
            
            {/* Barra de Progresso Real/Animada */}
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 rounded-full ${isClassifying ? 'bg-blue-500 w-2/3 animate-pulse' : 'bg-emerald-500 w-full'}`}
              ></div>
            </div>

            {classificationMessage && (
              <p className="text-xs text-slate-500 italic">
                {classificationMessage}
              </p>
            )}
          </div>
        </div>
      )}


      {/* --- Header & Controls --- */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="text-blue-600" />
            Gestão Unificada
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <select
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
          >
            <option value="">Todos os Meses</option>
            {availableUnifiedMonths.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>



          {/* GRUPO ENERGIA */}
          <div className="flex flex-col min-w-[140px]">
            <div className="bg-[#FFB100] text-black text-[10px] font-bold text-center py-1 uppercase tracking-widest border border-slate-300 border-b-0 leading-none h-6 flex items-center justify-center rounded-t-sm">
              ENERGIA
            </div>
            <div className="flex overflow-hidden rounded-b-sm">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex-1 bg-[#FFC107] hover:bg-[#FFD54F] text-black text-xs font-bold px-3 py-2 border border-slate-300 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : "Fatura"}
              </button>
              <button
                onClick={() => { setShowMonthModal(true); setUploadType('energy'); setIsCameraMode(false); }}
                disabled={isProcessingReading}
                className="flex-1 bg-[#FFC107] hover:bg-[#FFD54F] text-black text-xs font-bold px-3 py-2 border border-slate-300 border-l-0 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessingReading ? <Loader2 size={12} className="animate-spin" /> : "Galeria"}
              </button>
              <button
                onClick={() => { setShowMonthModal(true); setUploadType('energy'); setIsCameraMode(true); }}
                disabled={isProcessingReading}
                className="flex-1 bg-[#FFC107] hover:bg-[#FFD54F] text-black text-[10px] font-bold px-2 py-2 border border-slate-300 border-l-0 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessingReading ? <Loader2 size={12} className="animate-spin" /> : <><Camera size={10} /> Foto</>}
              </button>
            </div>
          </div>

          {/* GRUPO AGUA */}
          <div className="flex flex-col min-w-[140px]">
            <div className="bg-[#B3E5FC] text-black text-[10px] font-bold text-center py-1 uppercase tracking-widest border border-slate-300 border-b-0 leading-none h-6 flex items-center justify-center rounded-t-sm">
              AGUA
            </div>
            <div className="flex overflow-hidden rounded-b-sm">
              <button
                onClick={() => waterFileInputRef.current?.click()}
                disabled={isProcessingWater}
                className="flex-1 bg-[#E1F5FE] hover:bg-[#B3E5FC] text-black text-xs font-bold px-3 py-2 border border-slate-300 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessingWater ? <Loader2 size={12} className="animate-spin" /> : "Fatura"}
              </button>
              <button
                onClick={() => { setShowMonthModal(true); setUploadType('water'); setIsCameraMode(false); }}
                disabled={isProcessingWaterReading}
                className="flex-1 bg-[#E1F5FE] hover:bg-[#B3E5FC] text-black text-xs font-bold px-3 py-2 border border-slate-300 border-l-0 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessingWaterReading ? <Loader2 size={12} className="animate-spin" /> : "Galeria"}
              </button>
              <button
                onClick={() => { setShowMonthModal(true); setUploadType('water'); setIsCameraMode(true); }}
                disabled={isProcessingWaterReading}
                className="flex-1 bg-[#E1F5FE] hover:bg-[#B3E5FC] text-black text-[10px] font-bold px-2 py-2 border border-slate-300 border-l-0 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {isProcessingWaterReading ? <Loader2 size={12} className="animate-spin" /> : <><Camera size={10} /> Foto</>}
              </button>
            </div>
          </div>

          {/* NOVO GRUPO UPLOAD UNIFICADO */}
          <div className="flex flex-col min-w-[70px]">
            <div className="bg-[#E2E8F0] text-slate-700 text-[10px] font-bold text-center py-1 uppercase tracking-widest border border-slate-300 border-b-0 leading-none h-6 flex items-center justify-center rounded-t-sm">
              IA
            </div>
            <div className="flex overflow-hidden rounded-b-sm">
              <button
                onClick={() => unifiedFileInputRef.current?.click()}
                disabled={isClassifying}
                className="flex-1 bg-[#F8FAFC] hover:bg-white text-blue-600 text-xs font-bold px-4 py-2 border border-slate-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
              >
                {isClassifying ? <Loader2 size={12} className="animate-spin" /> : <><UploadCloud size={14} /> Upload</>}
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* --- UNIFIED TABLE (DESKTOP) --- */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                <th className="py-0.5 px-3 text-center leading-none">Unidade</th>
                <th className="py-0.5 px-3 text-center w-24 leading-none">Total</th>
                <th className="py-0.5 px-3 text-center w-24 leading-none">Documentos</th>
                <th className="py-0.5 px-3 text-center leading-none">Medidor Ant.</th>
                <th className="py-0.5 px-3 text-center leading-none">Medidor Atual</th>
                <th className="py-0.5 px-3 text-center leading-none">Consumo</th>
                <th className="py-0.5 px-3 text-center leading-none">R$ p/ Unid.</th>
                <th className="py-0.5 px-3 text-center leading-none">Bandeira</th>
                <th className="py-0.5 px-3 text-center leading-none">Desc. Casa</th>
                <th className="py-0.5 px-3 text-center leading-none">Valor Total</th>
                <th className="py-0.5 px-3 text-center w-24 leading-none">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedGroups.map((group, index) => {
                const isEven = index % 2 === 0;
                const rowBg = isEven ? 'bg-slate-100/50' : 'bg-white';

                return (
                  <React.Fragment key={group.key}>
                    {/* FIRST ROW: COMMON + ENERGY */}
                    <tr className={`hover:bg-emerald-50/60 transition-colors ${rowBg}`}>
                      {/* Common Columns (Rowspan 2) */}
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-r border-slate-100 ${rowBg}`}>
                        <div className="text-slate-800 font-bold text-xs leading-none">{group.property?.address || 'N/A'}</div>
                        <span className="text-slate-400 text-[9px] block mt-0.5">{group.month}</span>
                      </td>
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-r border-slate-100 ${rowBg}`}>
                        <div className="text-slate-900 font-bold text-sm leading-none">{group.grandTotal > 0 ? `R$ ${group.grandTotal.toFixed(2)}` : '-'}</div>
                      </td>
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-r border-slate-100 ${rowBg}`}>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => generateUnifiedPDF(group)}
                            className="p-1 px-[3px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded transition-all border border-emerald-100"
                            title="Gerar Relatório Unificado"
                          >
                            <FileDown size={18} />
                          </button>
                          <button
                            onClick={() => handleSendWhatsapp(group)}
                            className="p-1 px-[3px] bg-green-50 text-green-600 hover:bg-green-100 rounded transition-all border border-green-100"
                            title="Enviar por WhatsApp"
                          >
                            <MessageCircle size={18} />
                          </button>
                        </div>
                      </td>

                      {/* ENERGY DATA */}
                      <td className="py-[1px] px-2 text-center text-xs text-slate-600 leading-none">
                        <div className="flex items-center justify-center gap-1">
                          <Zap size={10} className="text-amber-500 opacity-40" />
                          {group.energy.prevReading ?? '-'}
                        </div>
                      </td>
                      <td className="py-[1px] px-2 text-center">
                        {group.energy.reading?.currentReading ? (
                          <div className="flex items-center justify-center gap-1 group/edit leading-none">
                            <span className="text-slate-700 text-xs" title={group.energy.reading.meterSerial ? `Medidor: ${group.energy.reading.meterSerial}` : undefined}>{group.energy.reading.currentReading}</span>
                            {group.energy.reading.isReplacement && <span className="text-[8px] text-orange-500 font-bold" title={group.energy.reading.meterSerial ? `Troca: ${group.energy.reading.meterSerial}` : "Troca de medidor"}>🔄</span>}
                            <button onClick={() => openReadingModal('energy', group.energy.reading!, group)} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-amber-500"><Edit2 size={11} /></button>
                            <button 
                              onClick={() => handleViewBill(group.energy.reading!, 'energy')} 
                              onMouseEnter={(e) => handleMouseEnterBill(e, group.energy.reading!, 'energy', 'right')}
                              onMouseMove={handleMouseMoveBill}
                              onMouseLeave={handleMouseLeaveBill}
                              className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-blue-500"
                            >
                              <Eye size={11} />
                            </button>
                          </div>
                        ) : <span className="text-slate-300 text-xs leading-none">-</span>}
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none">{group.energy.consumption ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-500 leading-none">{group.energy.invoice?.kwhUnitCost?.toFixed(5) ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-amber-600 leading-none">{group.energy.houseFlag !== undefined ? `+${group.energy.houseFlag.toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-emerald-600 leading-none">{group.energy.houseRefund !== undefined ? `-${group.energy.houseRefund.toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs font-bold text-slate-700 leading-none">{group.energy.total ? `R$ ${group.energy.total.toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center border-l border-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => {
                              if (group.energy.invoice || group.energy.reading) handleViewBill((group.energy.invoice || group.energy.reading)!, 'energy');
                              else showToast("Sem conta de energia", "info");
                            }} 
                            onMouseEnter={(e) => {
                              if (group.energy.invoice) handleMouseEnterBill(e, group.energy.invoice, 'energy', 'left');
                              else setHoverPreview({ url: null, x: e.clientX, y: e.clientY, loading: false, side: 'left', noContent: true });
                            }}
                            onMouseMove={handleMouseMoveBill}
                            onMouseLeave={handleMouseLeaveBill}
                            className="p-1 text-slate-400 hover:text-blue-500" 
                            title="Ver Conta"
                          >
                            <FileText size={14} />
                          </button>
                          <button onClick={() => handleDeleteClick('energy', group)} className="p-1 text-slate-400 hover:text-red-500" title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>

                    {/* SECOND ROW: WATER */}
                    <tr className={`hover:bg-emerald-50/60 transition-colors ${rowBg}`}>
                      {/* Water Data */}
                      <td className="py-[1px] px-2 text-center text-xs text-slate-600 leading-none border-t border-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <Droplets size={10} className="text-blue-500 opacity-40" />
                          {group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'}
                        </div>
                      </td>
                      <td className="py-[1px] px-2.5 text-center border-t border-slate-50">
                        {group.water.reading?.currentReading ? (
                          <div className="flex items-center justify-center gap-1 group/edit leading-none">
                            <span className="text-slate-700 text-xs" title={group.water.reading.meterSerial ? `Medidor: ${group.water.reading.meterSerial}` : undefined}>{group.water.reading.currentReading.toFixed(3).replace('.', ',')}</span>
                            {group.water.reading.isReplacement && <span className="text-[8px] text-orange-500 font-bold" title={group.water.reading.meterSerial ? `Troca: ${group.water.reading.meterSerial}` : "Troca de medidor"}>🔄</span>}
                            <button onClick={() => openReadingModal('water', group.water.reading!, group)} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-amber-500"><Edit2 size={11} /></button>
                            <button 
                              onClick={() => handleViewBill(group.water.reading!, 'water')} 
                              onMouseEnter={(e) => handleMouseEnterBill(e, group.water.reading!, 'water', 'right')}
                              onMouseMove={handleMouseMoveBill}
                              onMouseLeave={handleMouseLeaveBill}
                              className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-blue-500"
                            >
                              <Eye size={11} />
                            </button>
                          </div>
                        ) : <span className="text-slate-300 text-xs leading-none">-</span>}
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none border-t border-slate-50">{group.water.consumption?.toFixed(3).replace('.', ',') ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-500 leading-none border-t border-slate-50">{group.water.invoice?.m3UnitCost?.toFixed(2) ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-300 leading-none border-t border-slate-50">-</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-300 leading-none border-t border-slate-50">-</td>
                      <td className="py-[1px] px-2 text-center text-xs font-bold text-slate-700 leading-none border-t border-slate-50">{group.water.total ? `R$ ${group.water.total.toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center border-t border-l border-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => {
                              if (group.water.invoice || group.water.reading) handleViewBill((group.water.invoice || group.water.reading)!, 'water');
                              else showToast("Sem conta de água", "info");
                            }} 
                            onMouseEnter={(e) => {
                              if (group.water.invoice) handleMouseEnterBill(e, group.water.invoice, 'water', 'left');
                              else setHoverPreview({ url: null, x: e.clientX, y: e.clientY, loading: false, side: 'left', noContent: true });
                            }}
                            onMouseMove={handleMouseMoveBill}
                            onMouseLeave={handleMouseLeaveBill}
                            className="p-1 text-slate-400 hover:text-blue-500" 
                            title="Ver Conta"
                          >
                            <FileText size={14} />
                          </button>
                          <button onClick={() => handleDeleteClick('water', group)} className="p-1 text-slate-400 hover:text-red-500" title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

              {filteredUnifiedGroups.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    Nenhum registro encontrado para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          
          {totalPages > 1 && (
            <div className="p-4 flex items-center justify-between border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <span className="text-sm font-medium text-slate-500">Página {currentPage} de {totalPages}</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 bg-white border border-slate-200 rounded text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors cursor-pointer"
                >Anterior</button>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, Math.min(totalPages, p + 1)))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 bg-white border border-slate-200 rounded text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors cursor-pointer"
                >Próxima</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden inputs for uploads */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept=".pdf,image/*" className="hidden" />
      <input type="file" ref={meterInputRef} onChange={handleMeterReadingUpload} multiple accept="image/*" className="hidden" />
      <input type="file" ref={energyCameraInputRef} onChange={handleMeterReadingUpload} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={waterFileInputRef} onChange={handleWaterFileChange} multiple accept=".pdf,image/*" className="hidden" />
      <input type="file" ref={waterMeterInputRef} onChange={handleWaterMeterReadingUpload} multiple accept="image/*" className="hidden" />
      <input type="file" ref={waterCameraInputRef} onChange={handleWaterMeterReadingUpload} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={unifiedFileInputRef} onChange={handleUnifiedFileChange} multiple accept=".pdf,image/*" className="hidden" />



      {/* --- MOBILE CARD VIEW --- */}
      <div className="md:hidden space-y-4">
        {filteredUnifiedGroups.map((group) => {
          // Calculate Totals safely
          const energyTotal = group.energy.total;
          const waterTotal = group.water.total;
          const grandTotal = (energyTotal || 0) + (waterTotal || 0);

          return (
            <div key={group.key} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              {/* Card Header */}
              <div className="bg-slate-900 text-white p-4 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-sm">{group.month}</h3>
                  <p className="text-xs text-slate-400">{group.property?.address || 'Unidade Desconhecida'}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase text-slate-400 font-bold block">Total</span>
                  <span className="text-lg font-bold text-emerald-400">{grandTotal > 0 ? `R$ ${grandTotal.toFixed(2)}` : '-'}</span>
                </div>
              </div>

              {/* Energy Section */}
              {(group.energy.invoice || group.energy.reading) && (
                <div className="p-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded bg-amber-100 text-amber-600 flex items-center justify-center">
                      <Zap size={14} />
                    </div>
                    <h4 className="font-bold text-slate-700 text-sm uppercase">Energia</h4>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-600">
                    <div>Leitura Ant.: <span className="font-mono font-bold text-slate-900">{group.energy.prevReading ?? '-'}</span></div>
                    <div>Leitura Atual:
                      <span className="font-mono font-bold text-slate-900 ml-1">
                        {group.energy.reading?.currentReading ?? '-'}
                        {group.energy.reading?.isReplacement && <span className="text-[8px] text-orange-500 ml-1" title="Troca">🔄</span>}
                        {group.energy.reading && (
                          <button onClick={() => openReadingModal('energy', group.energy.reading!, group)} className="ml-1 text-slate-400"><Edit2 size={10} /></button>
                        )}
                      </span>
                    </div>
                    <div>Consumo: <span className="font-bold">{group.energy.consumption ?? '-'} kWh</span></div>
                    <div>Valor: <span className="font-bold text-slate-900">{energyTotal !== undefined ? `R$ ${energyTotal.toFixed(2)}` : '-'}</span></div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        if (group.energy.invoice || group.energy.reading) handleViewBill((group.energy.invoice || group.energy.reading)!, 'energy');
                        else showToast("Sem conta de energia", "info");
                      }}
                      className="flex-1 bg-amber-50 text-amber-700 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <FileText size={12} /> Ver Fatura
                    </button>
                    <button
                      onClick={() => handleDeleteClick('energy', group)}
                      className="w-8 bg-red-50 text-red-500 rounded-lg flex items-center justify-center"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Water Section */}
              {(group.water.invoice || group.water.reading) && (
                <div className="p-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center">
                      <Droplets size={14} />
                    </div>
                    <h4 className="font-bold text-slate-700 text-sm uppercase">Água</h4>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-600">
                    <div>Leitura Ant.: <span className="font-mono font-bold text-slate-900">{group.water.prevReading?.toFixed(3) ?? '-'}</span></div>
                    <div>Leitura Atual:
                      <span className="font-mono font-bold text-slate-900 ml-1">
                        {group.water.reading?.currentReading?.toFixed(3) ?? '-'}
                        {group.water.reading?.isReplacement && <span className="text-[8px] text-orange-500 ml-1" title="Troca">🔄</span>}
                        {group.water.reading && (
                          <button onClick={() => openReadingModal('water', group.water.reading!, group)} className="ml-1 text-slate-400"><Edit2 size={10} /></button>
                        )}
                      </span>
                    </div>
                    <div>Consumo: <span className="font-bold">{group.water.consumption?.toFixed(3) ?? '-'} m³</span></div>
                    <div>Valor: <span className="font-bold text-slate-900">{waterTotal !== undefined ? `R$ ${waterTotal.toFixed(2)}` : '-'}</span></div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        if (group.water.invoice || group.water.reading) handleViewBill((group.water.invoice || group.water.reading)!, 'water');
                        else showToast("Sem conta de água", "info");
                      }}
                      className="flex-1 bg-blue-50 text-blue-700 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <FileText size={12} /> Ver Fatura
                    </button>
                    <button
                      onClick={() => handleDeleteClick('water', group)}
                      className="w-8 bg-red-50 text-red-500 rounded-lg flex items-center justify-center"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Actions Footer */}
              <div className="p-3 bg-slate-50 flex gap-2">
                <button
                  onClick={() => generateUnifiedPDF(group)}
                  className="flex-1 bg-white border border-slate-200 text-slate-700 py-2.5 rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-2"
                >
                  <FileDown size={14} /> PDF
                </button>
                <button
                  onClick={() => handleSendWhatsapp(group)}
                  className="flex-1 bg-green-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-md shadow-green-500/20 flex items-center justify-center gap-2"
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
              </div>


            </div>
          );
        })}

        {filteredUnifiedGroups.length === 0 && (
          <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-400 text-sm">Nenhum registro encontrado.</p>
          </div>
        )}
      </div>

      {/* --- READING EDIT MODAL (Troca de Medidor) --- */}
      {readingModal.show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-slate-900 p-4 text-white flex justify-between items-center sticky top-0 z-10">
              <h3 className="font-bold flex items-center gap-2">
                <Edit2 size={18} className="text-amber-400" />
                Editar Leitura {readingModal.type === 'energy' ? '⚡ Energia' : '💧 Água'}
              </h3>
              <button onClick={closeReadingModal} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Info da unidade */}
              <div className="text-xs text-slate-500">
                <span className="font-bold text-slate-700">{readingModal.group?.property?.address || 'N/A'}</span>
                <span className="ml-2">• {readingModal.group?.month}</span>
              </div>

              {/* Campo Leitura Atual do Medidor Antigo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  {readingModal.type === 'energy' ? '⚡' : '💧'} Leitura Atual (Medidor {isReplacementEnabled ? 'Antigo' : ''})
                </label>
                <input
                  type="number"
                  value={readingModalValue}
                  onChange={e => setReadingModalValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !isReplacementEnabled) saveReadingModal(); }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold text-lg"
                  autoFocus
                />
              </div>

              {/* Divider */}
              <div className="border-t border-slate-100 pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Foto Leitura Atual (Opcional)
                  </label>
                  <div className="flex items-center gap-4">
                    {currentReadingPhoto && (
                      <div className="relative w-20 h-24 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                        <img src={currentReadingPhoto} alt="Atual" className="w-full h-full object-cover" />
                        <button 
                          onClick={() => setCurrentReadingPhoto(null)} 
                          className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl hover:bg-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <label className="flex flex-col items-center justify-center w-20 h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-orange-500 hover:bg-orange-50 transition-all duration-200">
                      <Camera className="w-6 h-6 text-gray-400" />
                      <span className="text-[10px] text-gray-500 mt-1">Alterar</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setCurrentReadingPhoto(reader.result as string);
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>

                {/* Código do Medidor */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    🔢 Código do Medidor (Interno)
                  </label>
                  <input
                    type="text"
                    value={meterSerial}
                    onChange={e => setMeterSerial(e.target.value)}
                    placeholder="Ex: MED-001"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Switch de Troca de Medidor */}
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-700">🔄 Troca de Medidor</span>
                    <span className="text-[10px] text-slate-400">(houve substituição neste mês)</span>
                  </div>
                  <div className={`relative w-12 h-6 rounded-full transition-colors ${isReplacementEnabled ? 'bg-orange-500' : 'bg-slate-200'}`}
                    onClick={() => setIsReplacementEnabled(!isReplacementEnabled)}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${isReplacementEnabled ? 'translate-x-6' : 'translate-x-0.5'}`}></div>
                  </div>
                </label>

              {/* Campos de Troca (aparecem quando habilitado) */}
              {isReplacementEnabled && (
                <div className="space-y-4 bg-orange-50 border border-orange-200 rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <p className="text-xs text-orange-700 font-semibold">
                    Preencha os dados do novo medidor instalado:
                  </p>

                  {/* Novo Medidor - Início */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase">
                      📷 Novo Medidor (Início)
                    </label>
                    <div className="flex gap-3 items-start">
                      <div className="flex-1">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={e => handleNewMeterPhotoUpload(e, 'start')}
                          className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-100 file:text-orange-700 hover:file:bg-orange-200 file:cursor-pointer"
                        />
                        {newMeterStartPhoto && (
                          <img src={newMeterStartPhoto} alt="Novo medidor início" className="mt-2 w-20 h-20 object-cover rounded-lg border border-orange-200" />
                        )}
                      </div>
                      <div className="w-32">
                        <label className="block text-[10px] text-slate-500 mb-0.5">Valor Início</label>
                        <input
                          type="number"
                          value={newMeterStartValue}
                          onChange={e => setNewMeterStartValue(e.target.value)}
                          placeholder="0"
                          className="w-full bg-white border border-orange-200 rounded-lg px-3 py-2 text-sm font-mono font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Novo Medidor - Final */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase">
                      📷 Novo Medidor (Final)
                    </label>
                    <div className="flex gap-3 items-start">
                      <div className="flex-1">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={e => handleNewMeterPhotoUpload(e, 'end')}
                          className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-100 file:text-orange-700 hover:file:bg-orange-200 file:cursor-pointer"
                        />
                        {newMeterEndPhoto && (
                          <img src={newMeterEndPhoto} alt="Novo medidor final" className="mt-2 w-20 h-20 object-cover rounded-lg border border-orange-200" />
                        )}
                      </div>
                      <div className="w-32">
                        <label className="block text-[10px] text-slate-500 mb-0.5">Valor Final</label>
                        <input
                          type="number"
                          value={newMeterEndValue}
                          onChange={e => setNewMeterEndValue(e.target.value)}
                          placeholder="0"
                          className="w-full bg-white border border-orange-200 rounded-lg px-3 py-2 text-sm font-mono font-bold focus:ring-2 focus:ring-orange-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preview do cálculo */}
                  {newMeterStartValue && newMeterEndValue && readingModalValue && (
                    <div className="bg-white rounded-lg p-3 border border-orange-100 text-xs text-slate-600">
                      <div className="font-bold text-slate-700 mb-1">📊 Prévia do consumo:</div>
                      <div>Med. Antigo: {readingModalValue} - {readingModal.group?.energy?.prevReading ?? readingModal.group?.water?.prevReading ?? '?'} = <span className="font-bold">{(parseFloat(readingModalValue) - (readingModal.type === 'energy' ? (readingModal.group?.energy?.prevReading ?? 0) : (readingModal.group?.water?.prevReading ?? 0))).toFixed(readingModal.type === 'water' ? 3 : 0)}</span></div>
                      <div>Med. Novo: {newMeterEndValue} - {newMeterStartValue} = <span className="font-bold">{(parseFloat(newMeterEndValue) - parseFloat(newMeterStartValue)).toFixed(readingModal.type === 'water' ? 3 : 0)}</span></div>
                      <div className="border-t border-orange-100 mt-1 pt-1 font-bold text-slate-900">
                        Consumo Total: {((parseFloat(readingModalValue) - (readingModal.type === 'energy' ? (readingModal.group?.energy?.prevReading ?? 0) : (readingModal.group?.water?.prevReading ?? 0))) + (parseFloat(newMeterEndValue) - parseFloat(newMeterStartValue))).toFixed(readingModal.type === 'water' ? 3 : 0)} {readingModal.type === 'energy' ? 'kWh' : 'm³'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeReadingModal}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveReadingModal}
                  disabled={isSavingReading}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingReading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {isSavingReading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- DELETE SELECTION MODAL --- */}
      {deleteModal.show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">
                <Trash2 size={18} className="text-red-400" />
                Excluir {deleteModal.type === 'energy' ? 'Energia' : 'Água'}
              </h3>
              <button onClick={() => setDeleteModal({ ...deleteModal, show: false })} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm font-bold text-slate-800 mb-1">{deleteModal.propertyAddress}</p>
              <p className="text-xs text-slate-400 mb-6">{deleteModal.month}</p>
              
              <div className="space-y-3">
                <button
                  onClick={() => {
                    if (deleteModal.invoiceId) {
                      if (deleteModal.type === 'energy') onDeleteBill(deleteModal.invoiceId);
                      else onDeleteWaterBill(deleteModal.invoiceId);
                    }
                    setDeleteModal({ ...deleteModal, show: false });
                  }}
                  className="w-full py-3 px-4 bg-slate-50 hover:bg-red-50 text-slate-700 hover:text-red-600 rounded-xl border border-slate-200 hover:border-red-200 transition-all text-sm font-bold flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-slate-100 group-hover:border-red-100">
                      <FileText size={16} className="text-slate-400 group-hover:text-red-500" />
                    </div>
                    <span>Excluir FATURA (PDF)</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    if (deleteModal.readingId) {
                      if (deleteModal.type === 'energy') onDeleteBill(deleteModal.readingId);
                      else onDeleteWaterBill(deleteModal.readingId);
                    }
                    setDeleteModal({ ...deleteModal, show: false });
                  }}
                  className="w-full py-3 px-4 bg-slate-50 hover:bg-red-50 text-slate-700 hover:text-red-600 rounded-xl border border-slate-200 hover:border-red-200 transition-all text-sm font-bold flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-slate-100 group-hover:border-red-100">
                      <Camera size={16} className="text-slate-400 group-hover:text-red-500" />
                    </div>
                    <span>Excluir LEITURA (Foto)</span>
                  </div>
                </button>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      if (window.confirm("Deseja realmente excluir AMBOS os registros?")) {
                        if (deleteModal.invoiceId) {
                          if (deleteModal.type === 'energy') onDeleteBill(deleteModal.invoiceId);
                          else onDeleteWaterBill(deleteModal.invoiceId);
                        }
                        if (deleteModal.readingId) {
                          if (deleteModal.type === 'energy') onDeleteBill(deleteModal.readingId);
                          else onDeleteWaterBill(deleteModal.readingId);
                        }
                        setDeleteModal({ ...deleteModal, show: false });
                      }
                    }}
                    className="w-full py-3 px-4 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl border border-red-100 transition-all text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <Trash2 size={14} />
                    Excluir Ambos os Registros
                  </button>
                </div>
              </div>

              <button
                onClick={() => setDeleteModal({ ...deleteModal, show: false })}
                className="w-full mt-6 py-2 text-slate-400 hover:text-slate-600 text-xs font-semibold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- FLOATING HOVER PREVIEW --- */}
      {(hoverPreview.url || hoverPreview.loading || hoverPreview.noContent) && (
        <div 
          className="fixed z-[999] pointer-events-none transition-opacity duration-200"
          style={{ 
            left: hoverPreview.x + (hoverPreview.side === 'right' ? 15 : -15), 
            top: hoverPreview.y - 50,
            transform: hoverPreview.side === 'left' ? 'translateX(-100%)' : 'none',
            opacity: (hoverPreview.url || hoverPreview.loading || hoverPreview.noContent) ? 1 : 0
          }}
        >
          <div className="bg-white p-2 rounded-xl shadow-2xl border border-slate-200 overflow-hidden transform scale-100 animate-in zoom-in-95 duration-200">
            {hoverPreview.loading ? (
              <div className="w-48 h-64 flex flex-col items-center justify-center gap-3 bg-slate-50">
                <Loader2 size={32} className="text-blue-500 animate-spin" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Carregando...</span>
              </div>
            ) : hoverPreview.noContent ? (
              <div className="w-48 h-32 flex flex-col items-center justify-center gap-3 bg-slate-50 border-2 border-dashed border-slate-200 rounded-lg">
                <AlertTriangle size={32} className="text-amber-400" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center px-4">Sem fatura anexada</span>
              </div>
            ) : (
              <div className="relative group">
                {hoverPreview.url?.toLowerCase().includes('.pdf') ? (
                  <div className="w-[350px] h-[450px] bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                    <iframe 
                      src={`${hoverPreview.url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} 
                      className="w-full h-full border-0 pointer-events-none" 
                      title="PDF Preview"
                    />
                    <div className="absolute inset-0 bg-transparent" /> {/* Overlay to prevent interaction issues */}
                  </div>
                ) : (
                  <img 
                    src={hoverPreview.url!} 
                    alt="Preview" 
                    className="max-w-[400px] max-h-[500px] object-contain rounded-lg shadow-inner"
                  />
                )}
                <div className="absolute top-2 right-2 bg-black/50 text-white text-[9px] px-2 py-0.5 rounded-full backdrop-blur-sm font-bold uppercase tracking-wider">
                  {hoverPreview.url?.toLowerCase().includes('.pdf') ? 'Fatura PDF' : 'Foto da Conta'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};