Unicode true
!include "MUI2.nsh"
!include "x64.nsh"

Name "bakame"
VIProductVersion "1.0.1.0"
VIAddVersionKey "ProductName" "bakame"
VIAddVersionKey "CompanyName" "Serge Benit"
VIAddVersionKey "LegalCopyright" "Customized and enhanced by Serge Benit. Original OpenCluely by TechyCSR and contributors."
VIAddVersionKey "FileDescription" "bakame adaptive installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\bakame"
RequestExecutionLevel user
Var ServiceMode
SetCompressor zlib
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Customized and enhanced by Serge Benit (@Sergeb250).$\r$\nOriginal OpenCluely by TechyCSR and contributors.$\r$\n$\r$\nSetup adapts to how you open it.$\r$\n$\r$\nRun as administrator to install the Windows service. Open normally to install for your account and run in the background.$\r$\n$\r$\nQuit stops Bakame. Open it again whenever you need it."
!define MUI_FINISHPAGE_TEXT "Bakame is installed.$\r$\n$\r$\nAn administrator launch uses the Windows service. A normal launch runs in the background without requesting administrator permission.$\r$\n$\r$\nEnter your AI and voice settings in the app."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This build requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    StrCpy $ServiceMode 1
    StrCpy $INSTDIR "$PROGRAMFILES64\bakame"
    SetShellVarContext all
  ${Else}
    StrCpy $ServiceMode 0
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\bakame"
    SetShellVarContext current
  ${EndIf}
FunctionEnd

Section "bakame"
  ${If} $ServiceMode == 1
  IfFileExists "$INSTDIR\resources\service\bakame.Service.exe" 0 installFiles
    nsExec::ExecToStack '"$INSTDIR\resources\service\bakame.Service.exe" --stop'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not stop the existing service: $1"
      Abort
    ${EndIf}
  ${EndIf}
  installFiles:
  IfFileExists "$INSTDIR\resources\service\bakame.Service.exe" 0 copyFiles
    nsExec::ExecToStack '"$INSTDIR\resources\service\bakame.Service.exe" --close-desktop'
    Pop $0
    Pop $1
  copyFiles:
  SetOutPath "$INSTDIR"
  File /r "${APP_DIRECTORY}\*"
  ${If} $ServiceMode == 1
  nsExec::ExecToStack '"$INSTDIR\resources\service\bakame.Service.exe" --install'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "The app files were copied, but Windows could not register or start the service: $1"
    Abort
  ${EndIf}
  ; Remove only the verified legacy installation after the replacement started.
  ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenCluelyDesktopService" "InstallLocation"
  StrCmp $2 "$PROGRAMFILES64\OpenCluely" 0 legacyDone
    Delete "$DESKTOP\OpenCluely.lnk"
    Delete "$SMPROGRAMS\OpenCluely\OpenCluely.lnk"
    Delete "$SMPROGRAMS\OpenCluely\Windows Services.lnk"
    RMDir "$SMPROGRAMS\OpenCluely"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenCluelyDesktopService"
    ; $2 was checked against the absolute fixed Program Files path above.
    RMDir /r "$2"
  legacyDone:
  ${Else}
    Exec '"$INSTDIR\bakame.exe"'
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall bakame.exe"
  CreateDirectory "$SMPROGRAMS\bakame"
  CreateShortcut "$SMPROGRAMS\bakame\bakame.lnk" "$INSTDIR\bakame.exe"
  ${If} $ServiceMode == 1
    CreateShortcut "$SMPROGRAMS\bakame\Windows Services.lnk" "$SYSDIR\mmc.exe" "services.msc"
  ${EndIf}
  CreateShortcut "$DESKTOP\bakame.lnk" "$INSTDIR\bakame.exe"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "DisplayName" "bakame"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "Publisher" "Serge Benit"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "URLInfoAbout" "https://github.com/Sergeb250"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "UninstallString" '$\"$INSTDIR\Uninstall bakame.exe$\"'
  WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "NoModify" 1
  WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService" "NoRepair" 1
SectionEnd

Function un.onInit
  SetRegView 64
  ${If} $INSTDIR == "$PROGRAMFILES64\bakame"
    UserInfo::GetAccountType
    Pop $0
    ${If} $0 != "Admin"
      ExecShell "runas" "$INSTDIR\Uninstall bakame.exe"
      Quit
    ${EndIf}
    StrCpy $ServiceMode 1
    SetShellVarContext all
  ${ElseIf} $INSTDIR == "$LOCALAPPDATA\Programs\bakame"
    StrCpy $ServiceMode 0
    SetShellVarContext current
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "Unexpected installation directory. No files were removed."
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  nsExec::ExecToStack '"$INSTDIR\resources\service\bakame.Service.exe" --close-desktop'
  Pop $0
  Pop $1
  ${If} $ServiceMode == 1
    nsExec::ExecToStack '"$INSTDIR\resources\service\bakame.Service.exe" --uninstall'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not remove the Windows service: $1"
      Abort
    ${EndIf}
    DeleteRegKey HKLM "Software\bakame"
  ${EndIf}
  Delete "$DESKTOP\bakame.lnk"
  Delete "$SMPROGRAMS\bakame\bakame.lnk"
  Delete "$SMPROGRAMS\bakame\Windows Services.lnk"
  RMDir "$SMPROGRAMS\bakame"
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\BakameDesktopService"
  ; un.onInit verifies the exact fixed path before recursive removal.
  RMDir /r "$INSTDIR"
SectionEnd
