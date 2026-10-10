$envFilePath = "..\..\apps\api\.env"
Get-Content $envFilePath | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } | ForEach-Object {
    $name, $value = $_.Split('=', 2)
    $value = $value.Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
}
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
