# Script para adicionar botão de cobrança na EnergyTab

$energyTabPath = "d:\Documentos\APP\Atual\components\EnergyTab.tsx"
$content = Get-Content $energyTabPath -Raw -Encoding UTF8

# Adicionar a função handleCharge antes do return statement
# Procurar por "const generateUnifiedPDF" e adicionar a função antes
$handleChargeFunction = @"

  // Função para criar cobrança pelo Asaas
  const handleChargeFromEnergyTab = async (group: any) => {
    const property = group.property;
    const tenant = property?.tenantId ? tenants.find(t => t.id === property.tenantId) : null;

    if (!tenant) {
      showToast('Esta unidade não possui inquilino vinculado.', 'error');
      return;
    }

    if (!filterMonth) {
      showToast('Selecione um mês para gerar a cobrança.', 'error');
      return;
    }

    // Verifica se já foi criada cobrança
    const chargeKey = ``${tenant.id}-${filterMonth}``;
    if (createdCharges[chargeKey]) {
      const confirmar = window.confirm('Esta cobrança já foi criada. Deseja criar uma nova cobrança?');
      if (!confirmar) return;
    }

    if (!tenant.cpf) {
      showToast(``O inquilino "${tenant.name}" não possui CPF cadastrado.``, 'error');
      return;
    }

    if (!tenant.dueDay) {
      showToast(``O inquilino "${tenant.name}" não possui dia de vencimento configurado.``, 'error');
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

      // Auto-vinculação
      if (!customerId) {
        showToast('Vinculando cliente no Asaas...', 'info');
        const cpfClean = tenant.cpf.replace(/\D/g, '');

        if (!tenant.email && !tenant.phone) {
          showToast(``O inquilino "${tenant.name}" precisa ter email ou telefone cadastrado.``, 'error');
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
            tenant.email || ``sem-email-${cpfClean}@boitto.app``,
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
      const monthUtilitiesStr = ``${monthNames[parseInt(month) - 1]}/${year}``;
      
      let nextMonth = parseInt(month) + 1;
      let nextYear = parseInt(year);
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
      }
      const monthRentStr = ``${monthNames[nextMonth - 1]}/${nextYear}``;

      const description = ``Aluguel + Contas\n`` +
        ``Ref: ${monthUtilitiesStr} (Consumo) / ${monthRentStr} (Aluguel)\n\n`` +
        ``• Aluguel (${monthRentStr}): R$ ${rent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`` +
        ``• Água (${monthUtilitiesStr}): R$ ${waterValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`` +
        ``• Energia (${monthUtilitiesStr}): R$ ${energyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n`` +
        ``Endereço: ${property.address}``;

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

      // Salvar status
      const newCreatedCharges = { ...createdCharges, [chargeKey]: payment.id };
      setCreatedCharges(newCreatedCharges);
      localStorage.setItem('asaas-created-charges', JSON.stringify(newCreatedCharges));

      showToast(``Cobrança criada com sucesso! ID: ${payment.id}``, 'success');

      if (payment.invoiceUrl) {
        window.open(payment.invoiceUrl, '_blank');
      }
    } catch (error: any) {
      console.error('Erro ao criar cobrança:', error);
      showToast(``Erro ao criar cobrança: ${error.message || 'Erro desconhecido'}``, 'error');
    } finally {
      setLoadingCharge(null);
    }
  };
"@

if ($content -match "const generateUnifiedPDF") {
    $content = $content -replace "const generateUnifiedPDF", ($handleChargeFunction + "`r`n  const generateUnifiedPDF")
    Set-Content -Path $energyTabPath -Value $content -Encoding UTF8 -NoNewline
    Write-Host "Função handleChargeFromEnergyTab adicionada com sucesso!"
}
else {
    Write-Host "ERRO: Não encontrou o ponto de inserção"
    exit 1
}
