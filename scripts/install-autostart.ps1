<#
  Legt im Windows-Autostart eine Verknüpfung an, die bei jeder Anmeldung
  scripts\dev-up.ps1 ausführt (Internet abwarten, WLAN-IP eintragen, Server starten).

      powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
      powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall

  Braucht keine Adminrechte: Der Autostart-Ordner gehört dem eigenen Benutzer.
  `-ExecutionPolicy Bypass` gilt nur für diesen einen Aufruf und ändert keine
  Systemeinstellung.
#>
param([switch]$Uninstall)

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'GOE4Fun Dev-Umgebung.lnk'

if ($Uninstall) {
    if (Test-Path $link) { Remove-Item $link -Force; Write-Host "Entfernt: $link" } else { Write-Host 'Kein Autostart-Eintrag vorhanden.' }
    return
}

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'dev-up.ps1'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
# -NoExit: Das Fenster mit dem Statusbericht bleibt offen, bis man es schließt.
$shortcut.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$script`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'GÖ4Fun: WLAN-IP eintragen und Dev-Server starten'
$shortcut.Save()

Write-Host "Angelegt: $link"
