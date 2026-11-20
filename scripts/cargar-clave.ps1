# Guarda en .env el valor copiado en el portapapeles para la variable indicada,
# sin mostrarlo en pantalla, y vacía el portapapeles. Ejemplos:
#   powershell -ExecutionPolicy Bypass -File scripts\cargar-clave.ps1 WHATSAPP_TOKEN
#   powershell -ExecutionPolicy Bypass -File scripts\cargar-clave.ps1 WHATSAPP_PHONE_NUMBER_ID
param([Parameter(Mandatory = $true)][ValidatePattern('^[A-Z][A-Z0-9_]+$')][string]$Variable)
$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '..\.env'
$valor = (Get-Clipboard -Raw)
if ($null -ne $valor) { $valor = $valor.Trim() }
if (-not $valor -or $valor -match '\s') {
  Write-Output "El portapapeles está vacío o tiene espacios: copiá de nuevo el valor de $Variable."
  exit 1
}
$lineas = @(Get-Content $archivo -Encoding utf8 | Where-Object { $_ -notmatch "^$Variable=" })
$lineas += "$Variable=$valor"
[System.IO.File]::WriteAllLines((Resolve-Path $archivo), $lineas, (New-Object System.Text.UTF8Encoding $false))
Set-Clipboard -Value ' '
Write-Output "$Variable guardada en .env (no se muestra). Portapapeles vaciado."
