$file = "d:\Documentos\APP\Atual\components\EnergyTab.tsx"
$content = Get-Content $file -Raw -Encoding UTF8

# Ler a função do arquivo separado
$functionContent = Get-Content "d:\Documentos\APP\Atual\handleChargeFromEnergyTab.ts" -Raw -Encoding UTF8

# Adicionar a função antes do último return (antes de fechar o componente)
# Procurar por "return (" no final do arquivo e adicionar a função antes
$searchPattern = "  return \("
if ($content -match $searchPattern) {
    $replacement = "  // Handler para criar cobrança do Asaas`r`n  " + $functionContent.Trim() + "`r`n`r`n  return ("
    $content = $content -replace "  return \(", $replacement
    
    # Substituir o onClick do botão de "alert" para chamar a função real
    $oldOnClick = "onClick=\{\(\) => alert\('Cobrança em desenvolvimento'\)\}"
    $newOnClick = "onClick={() => handleChargeFromEnergyTab(group)}"
    $content = $content -replace [regex]::Escape($oldOnClick), $newOnClick
    
    Set-Content -Path $file -Value $content -Encoding UTF8 -NoNewline
    Write-Host "Função de cobrança adicionada e botão conectado com sucesso!"
}
else {
    Write-Host "ERRO: Não encontrou o padrão de busca"
    exit 1
}
