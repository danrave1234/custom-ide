; Vide was named VibeDeck up to v1.0.0. Tauri's NSIS installer keys the install
; folder, the Start menu and desktop shortcuts and the uninstall entry by product
; name, so without this hook Vide would install next to the old VibeDeck.
;
; Before installing, remove VibeDeck with its own uninstaller in silent mode.
; That keeps user data (settings, agent token, webview storage), which lives
; under the unchanged bundle identifier. The installer skips creating shortcuts
; in update mode (how the in-app updater runs it), so afterwards recreate the
; shortcuts VibeDeck had, under the new name.
;
; The installer only uses per-user (HKCU) installs, so only that hive is checked.

!ifndef LEGACY_PRODUCTNAME
  !define LEGACY_PRODUCTNAME "VibeDeck"
!endif
!ifndef LEGACY_BINARY
  !define LEGACY_BINARY "vibedeck.exe"
!endif
!define LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCTNAME}"

Var LegacyHadStartMenu
Var LegacyHadDesktop

!macro NSIS_HOOK_PREINSTALL
  Push $R7
  Push $R8
  ClearErrors
  ReadRegStr $R7 HKCU "${LEGACY_UNINSTKEY}" "UninstallString"
  ${IfNot} ${Errors}
  ${AndIf} $R7 != ""
    ReadRegStr $R8 HKCU "${LEGACY_UNINSTKEY}" "InstallLocation"
    ; both values are stored wrapped in quotes
    nsis_tauri_utils::StrReplace "$R7" '"' ""
    Pop $R7
    nsis_tauri_utils::StrReplace "$R8" '"' ""
    Pop $R8
    ${If} $R8 == ""
      ${GetParent} "$R7" $R8
    ${EndIf}
    ${If} ${FileExists} "$R7"
      ${IfThen} ${FileExists} "$SMPROGRAMS\${LEGACY_PRODUCTNAME}.lnk" ${|} StrCpy $LegacyHadStartMenu 1 ${|}
      ${IfThen} ${FileExists} "$DESKTOP\${LEGACY_PRODUCTNAME}.lnk" ${|} StrCpy $LegacyHadDesktop 1 ${|}
      DetailPrint "Replacing ${LEGACY_PRODUCTNAME} with ${PRODUCTNAME}; settings are kept"
      ; asks before closing a running copy (closes it automatically when silent/passive)
      !insertmacro CheckIfAppIsRunning "$R8\${LEGACY_BINARY}" "${LEGACY_PRODUCTNAME}"
      ; _?= runs the uninstaller in place and waits for it; it must be last and unquoted
      ExecWait '"$R7" /S _?=$R8'
      ; an in-place uninstaller cannot delete itself
      Delete "$R7"
      RMDir "$R8"
    ${EndIf}
  ${EndIf}
  Pop $R8
  Pop $R7
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $LegacyHadStartMenu = 1
  ${AndIfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  ${If} $LegacyHadDesktop = 1
  ${AndIfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
