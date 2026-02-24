$dest = "C:\Users\Rogerio\.gemini\antigravity\brain\7e5b6bb5-d8c8-4c71-9005-4f43719ba6ed\full_codebase.md"
"# Full Codebase Snapshot" | Set-Content -Path $dest -Encoding UTF8

"## File: package.json" | Add-Content -Path $dest
"```json" | Add-Content -Path $dest
Get-Content "package.json" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: vite.config.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "vite.config.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: types.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "types.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: services/firebaseConfig.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "services/firebaseConfig.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: services/db.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "services/db.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: services/aiService.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "services/aiService.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: services/asaasService.ts" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "services/asaasService.ts" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: components/Layout.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "components/Layout.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: components/Toast.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "components/Toast.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: components/TenantList.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "components/TenantList.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: components/PropertyList.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "components/PropertyList.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: components/EnergyTab.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "components/EnergyTab.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: App.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "App.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: index.tsx" | Add-Content -Path $dest
"```typescript" | Add-Content -Path $dest
Get-Content "index.tsx" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

"## File: index.html" | Add-Content -Path $dest
"```html" | Add-Content -Path $dest
Get-Content "index.html" | Add-Content -Path $dest
"```" | Add-Content -Path $dest
"" | Add-Content -Path $dest

Write-Host "Done"
