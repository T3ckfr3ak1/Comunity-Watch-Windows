; CommunityWatch™ NSIS customizations
; - Kill running app before install
; - Clean old app data that will be replaced, while preserving logs

!macro customInit
  ; Best-effort kill if the app is running (ignore failures)
  ExecWait 'taskkill /IM "CommunityWatch.exe" /F'
  ExecWait 'taskkill /IM "CommunityWatch.exe" /T /F'
!macroend

!macro customInstall
  ; Preserve logs, wipe other app data.
  ; Electron userData can vary by appName/productName across builds, so we cover common paths.

  StrCpy $0 "$APPDATA\CommunityWatch"
  StrCpy $1 "$APPDATA\communitywatch-windows"
  StrCpy $2 "$LOCALAPPDATA\CommunityWatch"
  StrCpy $3 "$TEMP\cw_logs_backup"

  ; Backup logs from any known location
  RMDir /r "$3"
  CreateDirectory "$3"
  IfFileExists "$0\logs\*.*" 0 +2
    CopyFiles /SILENT "$0\logs\*.*" "$3"
  IfFileExists "$1\logs\*.*" 0 +2
    CopyFiles /SILENT "$1\logs\*.*" "$3"
  IfFileExists "$2\logs\*.*" 0 +2
    CopyFiles /SILENT "$2\logs\*.*" "$3"

  ; Wipe old data directories (but not Program Files install dir)
  RMDir /r "$0"
  RMDir /r "$1"
  RMDir /r "$2"

  ; Restore logs into primary location
  CreateDirectory "$0\logs"
  IfFileExists "$3\*.*" 0 +2
    CopyFiles /SILENT "$3\*.*" "$0\logs"
!macroend

