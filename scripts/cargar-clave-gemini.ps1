# Guarda en .env la clave de Gemini que esté copiada en el portapapeles,
# sin mostrarla en pantalla. Uso: copiar la clave en Google AI Studio y ejecutar
#   powershell -ExecutionPolicy Bypass -File scripts\cargar-clave-gemini.ps1
$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '..\.env'
$clave = (Get-Clipboard -Raw).Trim()
if ($clave -notmatch '^[A-Za-z0-9_.\-]{30,}$') {
  Write-Output 'El portapapeles no tiene una clave de Gemini válida. Copiala de nuevo en AI Studio.'
  exit 1
}
$lineas = @(Get-Content $archivo -Encoding utf8 | Where-Object { $_ -notmatch '^(GEMINI_API_KEY|IA_PROVEEDOR)=' })
$lineas += 'IA_PROVEEDOR=gemini'
$lineas += "GEMINI_API_KEY=$clave"
[System.IO.File]::WriteAllLines((Resolve-Path $archivo), $lineas, (New-Object System.Text.UTF8Encoding $false))
Set-Clipboard -Value ' '
Write-Output 'Clave de Gemini guardada en .env (no se muestra). Portapapeles vaciado.'
