param (
    [Parameter(Mandatory=$true)]
    [string]$InputFile,
    [string]$DbUrl = $env:DATABASE_URL
)

if (-not $DbUrl) {
    Write-Error "DATABASE_URL is not provided and not found in environment variables."
    exit 1
}

if (-not (Test-Path $InputFile)) {
    Write-Error "Backup file not found: $InputFile"
    exit 1
}

Write-Host "Restoring database from $InputFile..."
psql -d $DbUrl -f $InputFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "Restore completed successfully."
} else {
    Write-Error "Restore failed."
    exit $LASTEXITCODE
}
