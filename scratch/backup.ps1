$root = "c:\Users\muhammed.cer\Desktop\project_Inventory"
$dest = Join-Path $root "backup_txt"

if (!(Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest | Out-Null
}

# Copy root JS files
Get-ChildItem -Path $root -Filter *.js | ForEach-Object {
    $targetName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name) + ".txt"
    $targetPath = Join-Path $dest $targetName
    Copy-Item -Path $_.FullName -Destination $targetPath -Force
    Write-Output "Copied: $_.Name -> $targetName"
}

# Copy src folder files recursively, preserving directory structure but changing extension to .txt
$srcPath = Join-Path $root "src"
if (Test-Path $srcPath) {
    Get-ChildItem -Path $srcPath -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($srcPath.Length + 1)
        # Replace extension with .txt
        $relativeWithoutExt = [System.IO.Path]::ChangeExtension($relative, ".txt")
        $targetPath = Join-Path (Join-Path $dest "src") $relativeWithoutExt
        $targetDir = [System.IO.Path]::GetDirectoryName($targetPath)
        if (!(Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir | Out-Null
        }
        Copy-Item -Path $_.FullName -Destination $targetPath -Force
        Write-Output "Copied: src\$relative -> src\$relativeWithoutExt"
    }
}
Write-Output "Backup completed successfully!"
