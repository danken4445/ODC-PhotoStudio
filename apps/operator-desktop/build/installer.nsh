; Windows Defender Firewall lifecycle for the offline BYOD customer display.
; Exactly one inbound rule, scoped to the installed executable, TCP 47940, Private profile only.
; Uses the installer's existing elevation; if the installer is not elevated, netsh fails and the
; operator must add the rule manually (see docs/hardware-and-operations-runbook.md).
; The application itself never changes firewall settings.

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="ODC-PhotoStudio BYOD Display (Private)"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="ODC-PhotoStudio BYOD Display (Private)" dir=in action=allow protocol=TCP localport=47940 profile=private program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="ODC-PhotoStudio BYOD Display (Private)"'
  Pop $0
!macroend
