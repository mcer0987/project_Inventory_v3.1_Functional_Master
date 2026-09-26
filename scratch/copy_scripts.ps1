$files = @(
    "dark-mode-toggle.js",
    "todo-module.js",
    "security.js",
    "db.js",
    "alert.js",
    "timer.js",
    "personel.js",
    "pdf-generator.js",
    "firebase-handler.js",
    "data-loader.js",
    "purchase-servises.js",
    "edm-workflow.js",
    "script.js",
    "filter-module.js",
    "admin-backup.js",
    "system-tips.js",
    "admin-dashboard.js",
    "admin-purchase-render.js",
    "inventory-management.js",
    "admin-system-control.js",
    "admin-sitemap.js"
)

foreach ($file in $files) {
    $src = Join-Path "c:\Users\muhammed.cer\Desktop\project_Inventory" $file
    $destName = [System.IO.Path]::ChangeExtension($file, ".txt")
    $dest = Join-Path "c:\Users\muhammed.cer\Desktop\project_Inventory\scripts_txt" $destName
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Force
        Write-Output "Copied $file to $destName"
    } else {
        Write-Warning "File not found: $file"
    }
}
