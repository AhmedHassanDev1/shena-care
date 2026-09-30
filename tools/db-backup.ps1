param (
    [string]$DbUrl = $env:DATABASE_URL,
    [string]$OutputFile = "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
)

if (-not $DbUrl) {
    Write-Error "DATABASE_URL is not provided and not found in environment variables."
    exit 1
}

Write-Host "Backing up database to $OutputFile..."
pg_dump --clean --if-exists --format=plain --no-owner --no-acl --dbname=$DbUrl --file=$OutputFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "Backup completed successfully: $OutputFile"
} else {
    Write-Error "Backup failed."
    exit $LASTEXITCODE
}
