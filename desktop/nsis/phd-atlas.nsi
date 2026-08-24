Unicode true
Name "PhD Atlas"
OutFile "..\..\dist-desktop\PhDAtlas-0.1.1-win-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\PhD Atlas"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\..\dist-desktop\nsis-stage\payload\*.*"
  CreateDirectory "$SMPROGRAMS\PhD Atlas"
  CreateShortCut "$SMPROGRAMS\PhD Atlas\PhD Atlas.lnk" "$INSTDIR\PhD Atlas.bat" "" "$INSTDIR\runtime\node.exe"
  CreateShortCut "$DESKTOP\PhD Atlas.lnk" "$INSTDIR\PhD Atlas.bat" "" "$INSTDIR\runtime\node.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhDAtlas" "DisplayName" "PhD Atlas"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhDAtlas" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhDAtlas" "DisplayVersion" "0.1.1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhDAtlas" "Publisher" "PhD Atlas"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\PhD Atlas.lnk"
  RMDir /r "$SMPROGRAMS\PhD Atlas"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhDAtlas"
SectionEnd
