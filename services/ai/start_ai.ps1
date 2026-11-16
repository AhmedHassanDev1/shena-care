# Loads the API's .env first, then this service's own .env (which wins), and starts the AI service.
# Usage: .\start_ai.ps1 [-Port 8000] [-BindHost 127.0.0.1]   (loopback by default; pass 0.0.0.0 only inside a container)
# First run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
param([int]$Port = 8000, [string]$BindHost = "127.0.0.1")
$apiEnv = Resolve-Path (Join-Path $PSScriptRoot "../../apps/api/.env") -ErrorAction SilentlyContinue
$aiEnv = Resolve-Path (Join-Path $PSScriptRoot ".env") -ErrorAction SilentlyContinue
foreach ($envFilePath in @($apiEnv, $aiEnv)) {
    if (-not $envFilePath -or -not (Test-Path $envFilePath)) { continue }
    Get-Content $envFilePath | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), "Process")
    }
}
# Prefer the service's own virtualenv; fall back to whatever python is on PATH.
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }
& $python -m uvicorn app.main:app --host $BindHost --port $Port
