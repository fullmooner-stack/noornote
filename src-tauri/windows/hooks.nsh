; Custom NSIS hooks for NoorNote uninstaller
; Removes NoorSigner data directory when "Delete application data" is checked

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only delete if user checked "Delete application data"
  ${If} $DeleteAppDataCheckboxState = 1
    ; Remove NoorSigner data (Roaming AppData)
    RMDir /r "$APPDATA\NoorSigner"

    ; Remove NoorNote data (Local AppData)
    RMDir /r "$LOCALAPPDATA\Noornote"
  ${EndIf}
!macroend
