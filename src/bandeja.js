// Ícone na bandeja do Windows: fechar a janela não para a gravação (como todo NVR, o app segue gravando em segundo
// plano); para encerrar de vez, "Sair" no menu do ícone. Os textos seguem o idioma do Windows.
const { app, Tray, Menu, nativeImage } = require('electron');
const { join } = require('node:path');

const TEXTOS = {
  'pt-BR': ['Abrir o CCTV Express', 'Sair (para a gravação)', 'Gravando em segundo plano'],
  en: ['Open CCTV Express', 'Quit (stops recording)', 'Recording in the background'],
  es: ['Abrir CCTV Express', 'Salir (detiene la grabación)', 'Grabando en segundo plano'],
  fr: ['Ouvrir CCTV Express', "Quitter (arrête l'enregistrement)", 'Enregistrement en arrière-plan'],
  de: ['CCTV Express öffnen', 'Beenden (stoppt die Aufnahme)', 'Nimmt im Hintergrund auf'],
  it: ['Apri CCTV Express', 'Esci (ferma la registrazione)', 'Registrazione in background'],
  nl: ['CCTV Express openen', 'Afsluiten (stopt de opname)', 'Neemt op op de achtergrond'],
  pl: ['Otwórz CCTV Express', 'Zakończ (zatrzymuje nagrywanie)', 'Nagrywanie w tle'],
  ru: ['Открыть CCTV Express', 'Выйти (остановит запись)', 'Запись в фоновом режиме'],
  sv: ['Öppna CCTV Express', 'Avsluta (stoppar inspelningen)', 'Spelar in i bakgrunden'],
  tr: ["CCTV Express'i aç", 'Çık (kaydı durdurur)', 'Arka planda kaydediyor'],
  vi: ['Mở CCTV Express', 'Thoát (dừng ghi hình)', 'Đang ghi hình ở chế độ nền'],
  'zh-Hans': ['打开 CCTV Express', '退出（停止录像）', '正在后台录像'],
  ja: ['CCTV Express を開く', '終了（録画を停止）', 'バックグラウンドで録画中'],
  ko: ['CCTV Express 열기', '종료(녹화 중지)', '백그라운드에서 녹화 중'],
  id: ['Buka CCTV Express', 'Keluar (menghentikan rekaman)', 'Merekam di latar belakang'],
  hi: ['CCTV Express खोलें', 'बंद करें (रिकॉर्डिंग रुकेगी)', 'पृष्ठभूमि में रिकॉर्ड हो रहा है'],
  ar: ['فتح CCTV Express', 'خروج (يوقف التسجيل)', 'يسجّل في الخلفية'],
  he: ['פתיחת CCTV Express', 'יציאה (עוצר את ההקלטה)', 'מקליט ברקע'],
};

function textos() {
  for (const l of [...app.getPreferredSystemLanguages(), app.getLocale()]) {
    const k = Object.keys(TEXTOS).find((x) => x.toLowerCase() === l.toLowerCase()) || Object.keys(TEXTOS).find((x) => x.split('-')[0] === l.split('-')[0].toLowerCase());
    if (k) return TEXTOS[k];
    if (/^zh/i.test(l)) return TEXTOS['zh-Hans'];
  }
  return TEXTOS.en;
}

let bandeja = null;

function criar({ abrir, sair }) {
  if (bandeja) return bandeja;
  const [tAbrir, tSair, tDica] = textos();
  bandeja = new Tray(nativeImage.createFromPath(join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  bandeja.setToolTip(`CCTV Express · ${tDica}`);
  bandeja.setContextMenu(Menu.buildFromTemplate([{ label: tAbrir, click: abrir }, { type: 'separator' }, { label: tSair, click: sair }]));
  bandeja.on('click', abrir);
  return bandeja;
}

module.exports = { criar };
