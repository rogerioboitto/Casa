import React, { useRef, useState, useMemo } from 'react';
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
  const [readingMonth, setReadingMonth] = useState(new Date().toISOString().slice(0, 7)); // Default: Current Month YYYY-MM

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

  // --- ASAAS CHARGE STATE ---
  const DISCOUNT_VALUE = 50;
  const [loadingCharge, setLoadingCharge] = useState<string | null>(null);
  const [createdCharges, setCreatedCharges] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('asaas-created-charges');
    return saved ? JSON.parse(saved) : {};
  });

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

  // Helper para gerar IDs compatÃ­vel com navegadores antigos
  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
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
            const selectedMonth = readingMonth;

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
              const refMonth = extractedData.referenceMonth || 'N/A';

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
                id: generateUUID(),
                fileName: file.name,
                fileUrl: base64Data,
                uploadedAt: new Date().toISOString(),
                referenceMonth: extractedData.referenceMonth || 'N/A',
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
              referenceMonth: extractedData.referenceMonth || 'N/A',
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
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = 20;

    // --- Header ---
    doc.setFillColor(30, 41, 59); // slate-800 header bg
    doc.rect(0, 0, pageWidth, 40, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    const title = "Relatório de Consumo de Energia e Água";
    doc.text(title, pageWidth / 2, 20, { align: 'center' });

    // --- Subtitle ---
    // --- Subtitle ---
    // Histórico de Inquilinos: Busca o inquilino ativo no mês de referência
    const refDate = new Date(group.month + '-10'); // Use dia 10 para evitar timezone issues no início do mês
    const tenant = tenants.find(t => {
      // 1. Verifica se o inquilino estava vinculado a esta propriedade
      if (t.propertyId !== group.property?.id) return false;

      // 2. Verifica datas de entrada e saída
      const entry = t.entryDate ? new Date(t.entryDate) : null;
      const exit = t.exitDate ? new Date(t.exitDate) : null;

      // Se tem entrada e a fatura é de antes, não é ele
      if (entry && refDate < entry) return false;
      // Se tem saída e a fatura é de depois, não é ele
      if (exit && refDate > exit) return false;

      return true;
    }) || tenants.find(t => t.id === group.property?.tenantId); // Fallback: Inquilino atual

    const tenantName = tenant ? tenant.name : (group.property?.address || 'Unidade Desconhecida');

    // Formatar Mês
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    let formattedRef = group.month;
    if (group.month.includes('-')) {
      const [year, month] = group.month.split('-');
      formattedRef = `${monthNames[parseInt(month) - 1]} / ${year}`;
    }

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
      doc.roundedRect(margin, y, pageWidth - (margin * 2), 8, 2, 2, "FD"); // Header Box

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(2, 132, 199); // sky-600
      doc.text("ENERGIA ELÉTRICA", margin + 10, y + 5.5);

      // Icon placeholder (circle)
      doc.setFillColor(2, 132, 199);
      doc.circle(margin + 5, y + 4, 2, "F");

      y += 12;

      // Photos
      let prevFileUrl = group.energy.prevBill?.fileUrl;
      if (!prevFileUrl && group.energy.prevBill?.hasContent) {
        prevFileUrl = await db.getEnergyBillContent(group.energy.prevBill.id) || undefined;
      }
      let currentFileUrl = group.energy.reading?.fileUrl;
      if (!currentFileUrl && group.energy.reading?.hasContent) {
        currentFileUrl = await db.getEnergyBillContent(group.energy.reading.id) || undefined;
      }

      let photoY = y;
      if (prevFileUrl || currentFileUrl) {
        const imgW = 40; const imgH = 50; const gap = 5;
        if (prevFileUrl) {
          doc.setFontSize(8); doc.setTextColor(100);
          doc.text("Leitura Anterior", margin, y);
          doc.addImage(prevFileUrl, 'JPEG', margin, y + 2, imgW, imgH);
        }
        if (currentFileUrl) {
          doc.setFontSize(8); doc.setTextColor(100);
          doc.text("Leitura Atual", margin + imgW + gap, y);
          doc.addImage(currentFileUrl, 'JPEG', margin + imgW + gap, y + 2, imgW, imgH);
        }
      }

      // Dados Energia
      const startDataX = (prevFileUrl || currentFileUrl) ? margin + 95 : margin;
      let dataY = y + 2;

      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85); // slate-700

      const eLines = [
        [`Leitura Anterior:`, `${group.energy.prevReading ?? '-'}`],
        [`Leitura Atual:`, `${group.energy.reading?.currentReading ?? '-'}`],
        [`Consumo:`, `${group.energy.consumption ?? 0} kWh`],
        [`Tarifa (kWh):`, `R$ ${group.energy.invoice?.kwhUnitCost?.toFixed(5)?.replace('.', ',') ?? '0,00'}`],
        [`Bandeira:`, `R$ ${((group.energy.consumption || 0) * (group.energy.invoice?.flagAdditionalCost ? (group.energy.invoice.flagAdditionalCost / (group.energy.invoice.masterConsumption || 1)) : 0)).toFixed(2).replace('.', ',')}`],
        [`Subtotal Energia:`, `R$ ${group.energy.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
      ];

      eLines.forEach(([label, value]) => {
        doc.text(label, startDataX, dataY);
        doc.setFont("helvetica", "bold");
        doc.text(value, pageWidth - margin - 5, dataY, { align: 'right' });
        doc.setFont("helvetica", "normal");
        dataY += 7;
      });

      y = Math.max(y + 55, dataY + 10);
    }

    // --- WATER SECTION ---
    if (group.water.invoice || group.water.reading) {
      doc.setFillColor(236, 253, 245); // emerald-50
      doc.setDrawColor(167, 243, 208); // emerald-200
      doc.roundedRect(margin, y, pageWidth - (margin * 2), 8, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(5, 150, 105); // emerald-600
      doc.text("ÁGUA & ESGOTO", margin + 10, y + 5.5);

      // Icon placeholder
      doc.setFillColor(5, 150, 105);
      doc.circle(margin + 5, y + 4, 2, "F");

      y += 12;

      // Photos
      let prevFileUrl = group.water.prevBill?.fileUrl;
      if (!prevFileUrl && group.water.prevBill?.hasContent) {
        prevFileUrl = await db.getWaterBillContent(group.water.prevBill.id) || undefined;
      }
      let currentFileUrl = group.water.reading?.fileUrl;
      if (!currentFileUrl && group.water.reading?.hasContent) {
        currentFileUrl = await db.getWaterBillContent(group.water.reading.id) || undefined;
      }

      if (prevFileUrl || currentFileUrl) {
        const imgW = 40; const imgH = 50; const gap = 5;
        if (prevFileUrl) {
          doc.setFontSize(8); doc.setTextColor(100);
          doc.text("Leitura Anterior", margin, y);
          doc.addImage(prevFileUrl, 'JPEG', margin, y + 2, imgW, imgH);
        }
        if (currentFileUrl) {
          doc.setFontSize(8); doc.setTextColor(100);
          doc.text("Leitura Atual", margin + imgW + gap, y);
          doc.addImage(currentFileUrl, 'JPEG', margin + imgW + gap, y + 2, imgW, imgH);
        }
      }

      // Dados Água
      const startDataX = (prevFileUrl || currentFileUrl) ? margin + 95 : margin;
      let dataY = y + 2;

      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85); // slate-700

      const wLines = [
        [`Leitura Anterior:`, `${group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'}`],
        [`Leitura Atual:`, `${group.water.reading?.currentReading?.toFixed(3).replace('.', ',') ?? '-'}`],
        [`Consumo:`, `${group.water.consumption?.toFixed(3).replace('.', ',') ?? 0} m³`],
        [`Custo (m³):`, `R$ ${group.water.invoice?.m3UnitCost?.toFixed(2)?.replace('.', ',') ?? '0,00'}`],
        [`Subtotal Água:`, `R$ ${group.water.total?.toFixed(2)?.replace('.', ',') ?? '0,00'}`]
      ];

      wLines.forEach(([label, value]) => {
        doc.text(label, startDataX, dataY);
        doc.setFont("helvetica", "bold");
        doc.text(value, pageWidth - margin - 5, dataY, { align: 'right' });
        doc.setFont("helvetica", "normal");
        dataY += 7;
      });

      y = Math.max(y + 55, dataY + 10);
    }

    // --- TOTAL SUMMARY ---
    y += 10;

    // Background for Total
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.roundedRect(margin, y, pageWidth - (margin * 2), 25, 3, 3, "FD");

    const totalE = group.energy.total || 0;
    const totalW = group.water.total || 0;
    const finalTotal = totalE + totalW;

    // Labels
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Energia Elétrica:", margin + 10, y + 8);
    doc.text("Água & Esgoto:", margin + 10, y + 16);

    // Values
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50);
    doc.text(`R$ ${totalE.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 8, { align: 'right' });
    doc.text(`R$ ${totalW.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 16, { align: 'right' });

    // Divider inside box
    // doc.setDrawColor(226, 232, 240);
    // doc.line(margin + 10, y + 12, pageWidth - margin - 10, y + 12);

    // Grand Total
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text("TOTAL A PAGAR:", margin + 10, y + 21); // Alinhado com o valor
    doc.setTextColor(22, 163, 74); // green-600
    doc.setFontSize(16);
    doc.text(`R$ ${finalTotal.toFixed(2).replace('.', ',')}`, pageWidth - margin - 10, y + 22, { align: 'right' }); // Mais destaque

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
      const newWindow = window.open();
      if (newWindow) {
        newWindow.document.write(
          `<iframe src="${fileUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`
        );
      } else {
        alert("Permita pop-ups para visualizar a fatura.");
      }
    } else {
      alert("Arquivo da fatura não encontrado.");
    }
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
              const refMonth = extractedData.referenceMonth || 'N/A';

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
                referenceMonth: extractedData.referenceMonth || 'N/A',
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
              referenceMonth: extractedData.referenceMonth || 'N/A',
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
            const existingReading = waterBills.find(b =>
              b.propertyId === property.id &&
              b.referenceMonth === readingMonth &&
              b.currentReading !== undefined
            );

            if (existingReading) {
              if (!window.confirm(`Já existe uma LEITURA de ÁGUA para "${property.address}" no mês ${readingMonth}. Deseja sobrescrever?`)) {
                continue;
              }
              await onDeleteWaterBill(existingReading.id);
            }

            const compressedImage = await compressImage(base64Data);
            const newBill: WaterBill = {
              id: crypto.randomUUID(),
              fileName: `Leitura_Agua_${extracted.meterSerial}_${readingMonth}.jpg`,
              fileUrl: compressedImage,
              uploadedAt: new Date().toISOString(),
              referenceMonth: readingMonth,
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
    } finally {
      setIsProcessingWaterReading(false);
      setWaterUploadProgress(null);
      if (waterMeterInputRef.current) waterMeterInputRef.current.value = '';
    }
  };


  // --- UNIFIED LOGIC ---

  const availableUnifiedMonths = useMemo(() => {
    const months = new Set<string>();
    bills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
    waterBills.forEach(b => b.referenceMonth !== 'N/A' && months.add(b.referenceMonth));
    return Array.from(months).sort().reverse();
  }, [bills, waterBills]);

  const classifiedGroups = useMemo(() => {
    const groups = new Map<string, any>();

    // 1. Collect all keys from Energy
    sortedBills.forEach(b => {
      const propId = b.propertyId || (b.installationCode ? `inst_${b.installationCode}` : 'unknown');
      const key = `${propId}_${b.referenceMonth}`;
      if (!groups.has(key)) {
        // Find property object
        let property = b.propertyId ? properties.find(p => p.id === b.propertyId) : undefined;
        if (!property && b.installationCode) property = properties.find(p => p.mainMeterId === b.installationCode);

        groups.set(key, {
          key,
          month: b.referenceMonth,
          property,
          energy: {},
          water: {}
        });
      }
      const g = groups.get(key);
      if (b.currentReading !== undefined || b.fileName.toLowerCase().includes('leitura')) g.energy.reading = b;
      else g.energy.invoice = b;
    });

    // 2. Collect all keys from Water
    sortedWaterBills.forEach(b => {
      const propId = b.propertyId || (b.installationCode ? `inst_${b.installationCode}` : 'unknown');
      const key = `${propId}_${b.referenceMonth}`;
      if (!groups.has(key)) {
        let property = b.propertyId ? properties.find(p => p.id === b.propertyId) : undefined;
        if (!property && b.installationCode) property = properties.find(p => p.waterMeterId === b.installationCode);

        groups.set(key, {
          key,
          month: b.referenceMonth,
          property,
          energy: {},
          water: {}
        });
      }
      const g = groups.get(key);
      if (b.currentReading !== undefined || b.fileName.toLowerCase().includes('leitura')) g.water.reading = b;
      else g.water.invoice = b;
    });

    // 3. Process Data (Prev Readings, Totals)
    const result = Array.from(groups.values()).map(g => {
      // ENERGY CALCS
      if (g.energy.reading || g.energy.invoice) {
        const refMonth = g.month;
        const prevMonthStr = getPreviousMonth(refMonth);

        // Try to find prev reading
        const propKey = g.property?.id || (g.energy.invoice?.installationCode || g.energy.reading?.installationCode);
        if (propKey && prevMonthStr && readingsMap.has(propKey)) {
          g.energy.prevBill = readingsMap.get(propKey)!.get(prevMonthStr);
          if (g.energy.prevBill) g.energy.prevReading = g.energy.prevBill.currentReading;
        }

        const cur = g.energy.reading?.currentReading;
        const prev = g.energy.prevReading;

        // Recalculate totals for display consistency
        const consumption = cur !== undefined && prev !== undefined ? (cur - prev) : (g.energy.invoice?.masterConsumption || 0);
        g.energy.consumption = consumption; // Update for display

        const cost = g.energy.invoice?.kwhUnitCost || 0;
        const flag = g.energy.invoice?.flagAdditionalCost || 0;
        const refund = g.energy.invoice?.refundAmount || 0;
        const master = g.energy.invoice?.masterConsumption || 1;

        const houseFlag = (consumption * (flag / master)) || 0;
        const houseRefund = (consumption * (refund / master)) || 0;
        const base = consumption * cost;

        g.energy.total = base + houseFlag - houseRefund;

        // Strict check: if no reading, undefined
        // if (cur === undefined) {
        //      g.energy.consumption = undefined;
        //      g.energy.total = undefined;
        // }
      }

      // WATER CALCS
      if (g.water.reading || g.water.invoice) {
        const refMonth = g.month;
        const prevMonthStr = getPreviousMonth(refMonth);
        const propKey = g.property?.id || (g.water.invoice?.installationCode || g.water.reading?.installationCode);

        if (propKey && prevMonthStr && waterReadingsMap.has(propKey)) {
          g.water.prevBill = waterReadingsMap.get(propKey)!.get(prevMonthStr);
          if (g.water.prevBill) g.water.prevReading = g.water.prevBill.currentReading;
        }

        const cur = g.water.reading?.currentReading;
        const prev = g.water.prevReading;

        if (cur !== undefined && prev !== undefined) {
          g.water.consumption = cur - prev;
          g.water.total = g.water.consumption * (g.water.invoice?.m3UnitCost || 0);
        } else {
          g.water.consumption = undefined; // Strict
          g.water.total = undefined;
        }
      }

      g.grandTotal = (g.energy.total || 0) + (g.water.total || 0);
      return g;
    });

    // 4. Sort
    return result.sort((a, b) => {
      const mc = b.month.localeCompare(a.month);
      if (mc !== 0) return mc;
      const addrA = a.property?.address || '';
      const addrB = b.property?.address || '';
      return addrA.localeCompare(addrB);
    });

  }, [sortedBills, sortedWaterBills, properties, readingsMap, waterReadingsMap]);

  const filteredUnifiedGroups = useMemo(() => {
    if (!filterMonth) return classifiedGroups;
    return classifiedGroups.filter(g => g.month === filterMonth);
  }, [classifiedGroups, filterMonth]);


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
        </div>
      </div>

      {/* --- UNIFIED TABLE (DESKTOP) --- */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-0.5 px-3 text-center w-12 leading-none">Conta</th>
                <th className="py-0.5 px-3 text-center w-24 leading-none">Mês</th>
                <th className="py-0.5 px-3 text-center leading-none">Unidade</th>
                <th className="py-0.5 px-3 text-center leading-none">Medidor Ant.</th>
                <th className="py-0.5 px-3 text-center leading-none">Medidor Atual</th>
                <th className="py-0.5 px-3 text-center leading-none">Consumo</th>
                <th className="py-0.5 px-3 text-center leading-none">Tarifa</th>
                <th className="py-0.5 px-3 text-center leading-none">Bandeira</th>
                <th className="py-0.5 px-3 text-center leading-none">Devolução</th>
                <th className="py-0.5 px-3 text-center leading-none">Subtotal</th>
                <th className="py-0.5 px-3 text-center w-28 leading-none">Total</th>
                <th className="py-0.5 px-3 text-center w-36 leading-none">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnifiedGroups.map((group, index) => {
                const isEven = index % 2 === 0;
                const rowBg = isEven ? 'bg-slate-100/50' : 'bg-white';
                // Handler para criar cobranÃ§a do Asaas
                // Função completa de cobrança para EnergyTab
                const handleChargeFromEnergyTab = async (group: any) => {
                  const property = group.property;
                  const tenant = property?.tenantId ? tenants.find((t: any) => t.id === property.tenantId) : null;

                  if (!tenant) {
                    showToast('Esta unidade não possui inquilino vinculado.', 'error');
                    return;
                  }

                  const targetMonth = group.month;
                  if (!targetMonth) {
                    showToast('Mês do registro não identificado.', 'error');
                    return;
                  }

                  const chargeKey = `${tenant.id}-${targetMonth}`;
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

                    const dueDate = calculateDueDate(tenant.dueDay, targetMonth);
                    const dateObj = new Date(dueDate + 'T12:00:00');
                    dateObj.setDate(dateObj.getDate() - 1);
                    const limitDate = dateObj.toISOString().split('T')[0];

                    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
                    const [year, month] = targetMonth.split('-');
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
                        `Recibo_${tenantName}_${targetMonth}.pdf`,
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
                  <React.Fragment key={group.key}>
                    {/* FIRST ROW: HEADER/COMMON + ENERGY */}
                    <tr className={`hover:bg-emerald-50/60 transition-colors ${rowBg}`}>
                      {/* ENERGY ROW DATA (Icon first) */}
                      <td className="py-[1px] px-2 text-center bg-amber-50/30 border-r border-slate-100">
                        <div className="w-5 h-5 rounded bg-amber-100 text-amber-600 flex items-center justify-center mx-auto" title="Energia Elétrica"><Zap size={11} /></div>
                      </td>

                      {/* Common Columns (Rowspan 2) */}
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-r border-slate-100 ${rowBg}`}>
                        <span className="text-slate-700 font-mono text-xs block leading-none">{group.month}</span>
                      </td>
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-r border-slate-100 ${rowBg}`}>
                        <div className="text-slate-800 text-xs leading-none">{group.property?.address || 'N/A'}</div>
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-600 leading-none">{group.energy.prevReading ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center">
                        {group.energy.reading?.id && editingId === group.energy.reading.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              className="w-16 px-1 py-0 border border-blue-300 rounded text-center font-bold text-xs"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveReading(group.energy.reading!.id);
                                if (e.key === 'Escape') cancelEditing();
                              }}
                              autoFocus
                            />
                            <button onClick={() => saveReading(group.energy.reading!.id)} className="text-emerald-600"><Save size={14} /></button>
                          </div>
                        ) : (
                          group.energy.reading?.currentReading ? (
                            <div className="flex items-center justify-center gap-1 group/edit leading-none">
                              <span className="text-slate-700 text-xs">{group.energy.reading.currentReading}</span>
                              <button onClick={() => startEditing(group.energy.reading!)} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-amber-500"><Edit2 size={11} /></button>
                              <button onClick={() => handleViewBill(group.energy.reading!, 'energy')} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-blue-500"><Eye size={11} /></button>
                            </div>
                          ) : <span className="text-slate-300 text-xs leading-none">-</span>
                        )}
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none">{group.energy.consumption ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-500 leading-none">{group.energy.invoice?.kwhUnitCost?.toFixed(5) ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-amber-600 leading-none">{group.energy.invoice?.flagAdditionalCost ? `+${(group.energy.invoice.flagAdditionalCost * (group.energy.consumption / group.energy.invoice.masterConsumption)).toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-emerald-600 leading-none">{group.energy.invoice?.refundAmount ? `-${(group.energy.invoice.refundAmount * (group.energy.consumption / group.energy.invoice.masterConsumption)).toFixed(2)}` : '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none">{group.energy.total ? `R$ ${group.energy.total.toFixed(2)}` : '-'}</td>

                      {/* Total Geral (Rowspan 2) */}
                      <td rowSpan={2} className={`py-0.5 px-3 text-center align-middle border-x border-slate-100 ${rowBg}`}>
                        <div className="text-slate-900 text-sm leading-none">{group.grandTotal > 0 ? `R$ ${group.grandTotal.toFixed(2)}` : '-'}</div>
                      </td>

                      {/* Actions (Report Rowspan 2, others simple) */}
                      <td rowSpan={2} className="p-0 align-middle text-center w-32 border-l border-slate-100">
                        <div className="flex flex-row items-center justify-center h-full gap-2">
                          <div className="flex flex-row gap-2 items-center justify-center h-full pr-1">
                            <button
                              onClick={() => generateUnifiedPDF(group)}
                              className="p-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:shadow-md rounded transition-all"
                              title="Gerar Relatório Unificado"
                            >
                              <FileDown size={18} />
                            </button>
                            <button
                              onClick={() => handleSendWhatsapp(group)}
                              className="p-1 bg-green-50 text-green-600 hover:bg-green-100 hover:shadow-md rounded transition-all"
                              title="Enviar por WhatsApp"
                            >
                              <MessageCircle size={18} />
                            </button>

                          </div>
                          <div className="flex flex-col gap-2 pl-1 border-l border-slate-200">
                            {/* Energy Rows Actions */}
                            <div className="flex items-center gap-1">
                              <button onClick={() => {
                                if (group.energy.invoice || group.energy.reading) handleViewBill((group.energy.invoice || group.energy.reading)!, 'energy');
                                else showToast("Sem conta de energia", "info");
                              }} className={`p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-500 ${!group.energy.invoice && !group.energy.reading ? 'opacity-30' : ''}`} title="Fatura Energia (⚡)"><FileText size={14} /></button>
                              <button onClick={() => onDeleteBill(group.energy.invoice?.id || group.energy.reading?.id || '')} className={`p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 ${!group.energy.invoice && !group.energy.reading ? 'opacity-30' : ''}`} title="Excluir Energia"><Trash2 size={14} /></button>
                            </div>
                            {/* Water Rows Actions */}
                            <div className="flex items-center gap-1">
                              <button onClick={() => {
                                if (group.water.invoice || group.water.reading) handleViewBill((group.water.invoice || group.water.reading)!, 'water');
                                else showToast("Sem conta de água", "info");
                              }} className={`p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-500 ${!group.water.invoice && !group.water.reading ? 'opacity-30' : ''}`} title="Fatura Água (💧)"><FileText size={14} /></button>
                              <button onClick={() => onDeleteWaterBill(group.water.invoice?.id || group.water.reading?.id || '')} className={`p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 ${!group.water.invoice && !group.water.reading ? 'opacity-30' : ''}`} title="Excluir Água"><Trash2 size={14} /></button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* SECOND ROW: WATER */}
                    <tr className={`hover:bg-emerald-50/60 transition-colors ${rowBg}`}>
                      {/* Water Icon (First) */}
                      <td className="py-[1px] px-2 text-center bg-blue-50/30 border-r border-slate-100">
                        <div className="w-5 h-5 rounded bg-blue-100 text-blue-600 flex items-center justify-center mx-auto" title="Água & Esgoto"><Droplets size={11} /></div>
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-600 leading-none">{group.water.prevReading?.toFixed(3).replace('.', ',') ?? '-'}</td>
                      <td className="py-[1px] px-2.5 text-center">
                        {group.water.reading?.id && editingId === group.water.reading.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              className="w-16 px-1 py-0 border border-blue-300 rounded text-center font-bold text-xs"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveWaterReading(group.water.reading!.id);
                                if (e.key === 'Escape') cancelEditing();
                              }}
                              autoFocus
                            />
                            <button onClick={() => saveWaterReading(group.water.reading!.id)} className="text-emerald-600"><Save size={14} /></button>
                          </div>
                        ) : (
                          group.water.reading?.currentReading ? (
                            <div className="flex items-center justify-center gap-1 group/edit leading-none">
                              <span className="text-slate-700 text-xs">{group.water.reading.currentReading.toFixed(3).replace('.', ',')}</span>
                              <button onClick={() => startEditingWater(group.water.reading!)} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-amber-500"><Edit2 size={11} /></button>
                              <button onClick={() => handleViewBill(group.water.reading!, 'water')} className="opacity-0 group-hover/edit:opacity-100 text-slate-400 hover:text-blue-500"><Eye size={11} /></button>
                            </div>
                          ) : <span className="text-slate-300 text-xs leading-none">-</span>
                        )}
                      </td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none">{group.water.consumption?.toFixed(3).replace('.', ',') ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-500 leading-none">{group.water.invoice?.m3UnitCost?.toFixed(2) ?? '-'}</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-300 leading-none">-</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-300 leading-none">-</td>
                      <td className="py-[1px] px-2 text-center text-xs text-slate-700 leading-none">{group.water.total ? `R$ ${group.water.total.toFixed(2)}` : '-'}</td>
                    </tr>
                  </React.Fragment>
                );
              })}

              {filteredUnifiedGroups.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400">
                    Nenhum registro encontrado para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden inputs for uploads */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept=".pdf,image/*" className="hidden" />
      <input type="file" ref={meterInputRef} onChange={handleMeterReadingUpload} multiple accept="image/*" className="hidden" />
      <input type="file" ref={energyCameraInputRef} onChange={handleMeterReadingUpload} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={waterFileInputRef} onChange={handleWaterFileChange} multiple accept=".pdf,image/*" className="hidden" />
      <input type="file" ref={waterMeterInputRef} onChange={handleWaterMeterReadingUpload} multiple accept="image/*" className="hidden" />
      <input type="file" ref={waterCameraInputRef} onChange={handleWaterMeterReadingUpload} accept="image/*" capture="environment" className="hidden" />

      {/* --- MOBILE CARD VIEW --- */}
      <div className="md:hidden space-y-4">
        {filteredUnifiedGroups.map((group) => {
          // Calculate Totals safely
          const energyTotal = group.energy.total || 0;
          const waterTotal = group.water.total || 0;
          const grandTotal = energyTotal + waterTotal;

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
                  <span className="text-lg font-bold text-emerald-400">R$ {grandTotal.toFixed(2)}</span>
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
                      {group.energy.reading?.id && editingId === group.energy.reading.id ? (
                        <div className="inline-flex items-center gap-1 ml-1">
                          <input
                            type="number"
                            className="w-16 px-1 py-0 border border-blue-300 rounded text-center font-bold text-xs"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                          />
                          <button onClick={() => saveReading(group.energy.reading!.id)} className="text-emerald-600"><Save size={14} /></button>
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-slate-900 ml-1">
                          {group.energy.reading?.currentReading ?? '-'}
                          {group.energy.reading && (
                            <button onClick={() => startEditing(group.energy.reading!)} className="ml-1 text-slate-400"><Edit2 size={10} /></button>
                          )}
                        </span>
                      )}
                    </div>
                    <div>Consumo: <span className="font-bold">{group.energy.consumption ?? '-'} kWh</span></div>
                    <div>Valor: <span className="font-bold text-slate-900">R$ {energyTotal.toFixed(2)}</span></div>
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
                      onClick={() => onDeleteBill(group.energy.invoice?.id || group.energy.reading?.id || '')}
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
                      {group.water.reading?.id && editingId === group.water.reading.id ? (
                        <div className="inline-flex items-center gap-1 ml-1">
                          <input
                            type="number"
                            className="w-16 px-1 py-0 border border-blue-300 rounded text-center font-bold text-xs"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                          />
                          <button onClick={() => saveWaterReading(group.water.reading!.id)} className="text-emerald-600"><Save size={14} /></button>
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-slate-900 ml-1">
                          {group.water.reading?.currentReading?.toFixed(3) ?? '-'}
                          {group.water.reading && (
                            <button onClick={() => startEditingWater(group.water.reading!)} className="ml-1 text-slate-400"><Edit2 size={10} /></button>
                          )}
                        </span>
                      )}
                    </div>
                    <div>Consumo: <span className="font-bold">{group.water.consumption?.toFixed(3) ?? '-'} m³</span></div>
                    <div>Valor: <span className="font-bold text-slate-900">R$ {waterTotal.toFixed(2)}</span></div>
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
                      onClick={() => onDeleteWaterBill(group.water.invoice?.id || group.water.reading?.id || '')}
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
    </div >
  );
};

// Helper simples para chave segura
function strToKey(s?: string) {
  return s || '';
}