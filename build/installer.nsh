; Guarda o idioma escolhido no instalador; o app abre nele na primeira vez depois da instalação.
; Libera no Firewall do Windows a resposta das câmeras à busca ONVIF (WS-Discovery: a sonda vai por multicast e a
; câmera responde por unicast, que o firewall bloqueia sem regra) e o RTSP do go2rtc vindo das câmeras, só nas redes
; privada e de domínio. Sem elevação (instalação só para o usuário), o netsh falha e nada muda.
!macro customInstall
  WriteRegStr HKCU "Software\CCTV Express" "IdiomaInstalador" "$LANGUAGE"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="CCTV Express"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="CCTV Express" dir=in action=allow program="$INSTDIR\CCTV Express.exe" enable=yes profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="CCTV Express" dir=in action=allow program="$INSTDIR\resources\go2rtc.exe" enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="CCTV Express"'
!macroend
