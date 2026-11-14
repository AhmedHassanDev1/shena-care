# Loads the API's .env first, then this service's own .env (which wins), and starts the AI service.
# Usage: .\start_ai.ps1 [-Port 8000]
# First run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
param([int]$Port = 8000)
foreach ($envFilePath in @("..\..\apps\api\.env", ".\.env")) {
    if (-not (Test-Path $envFilePath)) { continue }
    Get-Content $envFilePath | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), "Process")
    }
}
# Prefer the service's own virtualenv; fall back to whatever python is on PATH.
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }
& $python -m uvicorn app.main:app --host 0.0.0.0 --port $Port
