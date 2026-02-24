/**
 * Asaas Payment Integration Service
 * Chamadas passam pelo proxy backend (Firebase Cloud Function)
 * API Documentation: https://docs.asaas.com/reference/criar-nova-cobranca
 */

const API_BASE = '/api/asaas';

interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
}

interface AsaasPaymentItem {
  description: string;
  value: number;
}

interface AsaasPayment {
  id: string;
  invoiceUrl: string;
  bankSlipUrl?: string;
  pixQrCode?: string;
  dueDate: string;
  value: number;
  status: string;
  customer: string;
  customerName?: string;
  paymentDate?: string;
  confirmedDate?: string;
  description?: string;
}

interface CreatePaymentParams {
  customerId: string;
  dueDate: string;
  value: number;
  description: string;
  items: AsaasPaymentItem[];
  discount?: {
    value: number;
    dueDateLimitDays?: number;
    limitDate?: string;
    type: 'FIXED' | 'PERCENTAGE';
  };
}

/**
 * Busca um cliente no Asaas por CPF
 */
export async function getCustomerByCpf(cpf: string): Promise<AsaasCustomer | null> {
  try {
    const cleanCpf = cpf.replace(/\D/g, '');
    const url = `${API_BASE}/customers?cpfCnpj=${cleanCpf}`;

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.data && data.data.length > 0 ? data.data[0] : null;
  } catch (error: any) {
    console.error('Error fetching customer from Asaas:', error);
    throw error;
  }
}

/**
 * Cria um novo cliente no Asaas
 */
export async function createCustomer(
  name: string,
  cpf: string,
  email: string,
  phone: string
): Promise<AsaasCustomer> {
  try {
    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone.replace(/\D/g, '');

    const response = await fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        cpfCnpj: cleanCpf,
        email,
        mobilePhone: cleanPhone,
        notificationDisabled: false
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${JSON.stringify(error)}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating customer in Asaas:', error);
    throw error;
  }
}

/**
 * Cria uma cobrança no Asaas com desconto (opcional)
 */
export async function createPayment(params: CreatePaymentParams): Promise<AsaasPayment> {
  try {
    const body: any = {
      customer: params.customerId,
      billingType: 'BOLETO', // BOLETO permite Boleto e Pix (exclui cartão)
      dueDate: params.dueDate,
      value: params.value,
      description: params.description,
      externalReference: `rent-${new Date().getTime()}`,
      fine: { value: 2, type: 'PERCENTAGE' },
      interest: { value: 1, type: 'PERCENTAGE' }
    };

    if (params.discount) {
      body.discount = params.discount;
    }

    const response = await fetch(`${API_BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${JSON.stringify(error)}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error in Asaas Service:', error);
    throw error;
  }
}

/**
 * Deleta uma cobrança no Asaas
 */
export async function deletePayment(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/payments/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${JSON.stringify(error)}`);
    }
  } catch (error: any) {
    console.error('Error deleting payment in Asaas:', error);
    throw error;
  }
}

/**
 * Calcula a data de vencimento baseado no dia do mês configurado.
 * Sempre aponta para o mês SEGUINTE ao mês de referência (filtro).
 */
export function calculateDueDate(dueDay: number, referenceMonth: string): string {
  const [year, month] = referenceMonth.split('-').map(Number);

  // Próximo mês
  let targetMonth = month + 1;
  let targetYear = year;

  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear++;
  }

  // Garantir que o dia não ultrapasse o último dia do mês alvo
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const day = Math.min(dueDay, lastDay);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Retorna o próximo mês em formato YYYY-MM baseado em uma string YYYY-MM
 */
export function getNextMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  let nextMonth = month + 1;
  let nextYear = year;

  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }

  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * Formata o mês de referência para exibição (ex: Janeiro/2026)
 */
export function formatReferenceMonth(monthStr: string): string {
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const [year, month] = monthStr.split('-');
  return `${monthNames[parseInt(month) - 1]}/${year}`;
}

/**
 * Busca cobranças no Asaas com filtros opcionais
 */
export async function getPayments(params: {
  status?: string;
  customer?: string;
  dueDate?: string;
  offset?: number;
  limit?: number;
}): Promise<{ data: AsaasPayment[], totalCount: number }> {
  try {
    let query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.customer) query.append('customer', params.customer);
    if (params.dueDate) {
      if (params.dueDate.length === 7) { // YYYY-MM
        const [year, month] = params.dueDate.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        query.append('dueDate[ge]', `${params.dueDate}-01`);
        query.append('dueDate[le]', `${params.dueDate}-${String(lastDay).padStart(2, '0')}`);
      } else {
        query.append('dueDate[ge]', params.dueDate);
        query.append('dueDate[le]', params.dueDate);
      }
    }
    query.append('limit', (params.limit || 100).toString());
    query.append('offset', (params.offset || 0).toString());

    const response = await fetch(`${API_BASE}/payments?${query.toString()}`, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return {
      data: data.data || [],
      totalCount: data.totalCount || 0
    };
  } catch (error: any) {
    console.error('Error fetching payments from Asaas:', error);
    throw error;
  }
}

/**
 * Busca lista de clientes do Asaas
 */
export async function getCustomers(params: { offset?: number; limit?: number } = {}): Promise<{ data: AsaasCustomer[] }> {
  try {
    const query = new URLSearchParams();
    query.append('limit', (params.limit || 100).toString());
    query.append('offset', (params.offset || 0).toString());

    const response = await fetch(`${API_BASE}/customers?${query.toString()}`, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Asaas API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error fetching customers from Asaas:', error);
    throw error;
  }
}

/**
 * Realiza o upload de um documento para uma cobrança (Ex: PDF de relatório)
 * availableAfterPayment: Se true, o arquivo só fica visível para o cliente após o pagamento
 */
export async function uploadPaymentDocument(
  paymentId: string,
  fileBase64: string,
  fileName: string = 'recibo.pdf',
  availableAfterPayment: boolean = true
): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/payments/${paymentId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileBase64,
        fileName,
        availableAfterPayment
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Asaas Upload API error: ${JSON.stringify(error)}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error uploading document to Asaas:', error);
    throw error;
  }
}