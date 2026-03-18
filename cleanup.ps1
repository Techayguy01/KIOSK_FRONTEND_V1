$ErrorActionPreference = "SilentlyContinue"
$root = "c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1"

# Delete files
Get-ChildItem -Path $root -Recurse -File | Where-Object {
    ($_.Name -like "*.md" -or $_.Name -like "*.docs") -and
    ($_.FullName -notlike "*\.agent\*") -and
    ($_.FullName -notlike "*\.ai\*")
} | Remove-Item -Force

# Delete directories named 'docs'
Get-ChildItem -Path $root -Recurse -Directory | Where-Object {
    ($_.Name -eq "docs") -and
    ($_.FullName -notlike "*\.agent\*") -and
    ($_.FullName -notlike "*\.ai\*")
} | Remove-Item -Recurse -Force

Write-Host "Cleanup complete."
