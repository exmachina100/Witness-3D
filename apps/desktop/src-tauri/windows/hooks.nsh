; Explorer thumbnails for .w3d files: the app registers its handler when it starts; the
; uninstaller takes the registration away before the DLL goes.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\w3d_thumbnail.dll"'
!macroend
