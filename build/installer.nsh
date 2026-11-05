
; Guarda o idioma escolhido no instalador; o app abre nele na primeira vez depois da instalação.
!macro customInstall
  WriteRegStr HKCU "Software\CCTV Express" "IdiomaInstalador" "$LANGUAGE"
!macroend
