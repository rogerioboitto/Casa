$file = "d:\Documentos\APP\Atual\components\AsaasTab.tsx"
$content = Get-Content $file -Raw -Encoding UTF8

# Add the confirmation check after line 238 (after dueDay validation)
$searchPattern = "        }\r\n\r\n        const total = waterValue"
$replacement = "        }\r\n\r\n        //Verifica se ja foi criada cobranca para este inquilino neste mes\r\n        const chargeKey = ``${tenant.id}-${filterMonth}``;\r\n        if (createdCharges[chargeKey]) {\r\n            const confirmar = window.confirm('Esta cobranca ja foi criada. Deseja criar uma nova cobranca?');\r\n            if (!confirmar) {\r\n                return;\r\n            }\r\n        }\r\n\r\n        const total = waterValue"

$newContent = $content -replace [regex]::Escape($searchPattern), $replacement
Set-Content -Path $file -Value $newContent -Encoding UTF8 -NoNewline
Write-Host "Patch applied successfully!"
