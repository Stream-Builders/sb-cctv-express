// Gera os strings.xml do app de câmera nos 18 idiomas do CCTV Express (os mesmos do app do computador).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src', 'main', 'res');
const K = ['app_nome', 'ao_vivo', 'parado', 'iniciar', 'parar', 'trocar', 'endereco', 'parado_ajuda', 'sem_rede', 'permissao', 'falha', 'credenciais'];
const T = {
  values: ['CCTV Express Camera', 'Live', 'Stopped', 'Start', 'Stop', 'Switch camera', 'Add this address to CCTV Express as an RTSP camera:', 'The camera is stopped. Tap Start to stream on your network.', 'Connect the phone to the same Wi-Fi network as the computer.', 'Allow camera and microphone access to stream.', 'This phone could not start the camera encoder.'],
  'values-pt': ['CCTV Express Câmera', 'Ao vivo', 'Parada', 'Iniciar', 'Parar', 'Trocar câmera', 'Adicione este endereço no CCTV Express como câmera RTSP:', 'A câmera está parada. Toque em Iniciar para transmitir na sua rede.', 'Conecte o celular na mesma rede Wi-Fi do computador.', 'Permita o uso da câmera e do microfone para transmitir.', 'Este celular não conseguiu iniciar o codificador da câmera.'],
  'values-es': ['CCTV Express Cámara', 'En vivo', 'Detenida', 'Iniciar', 'Detener', 'Cambiar cámara', 'Agrega esta dirección en CCTV Express como cámara RTSP:', 'La cámara está detenida. Toca Iniciar para transmitir en tu red.', 'Conecta el teléfono a la misma red Wi-Fi que la computadora.', 'Permite el acceso a la cámara y al micrófono para transmitir.', 'Este teléfono no pudo iniciar el codificador de la cámara.'],
  'values-fr': ['CCTV Express Caméra', 'En direct', 'Arrêtée', 'Démarrer', 'Arrêter', 'Changer de caméra', 'Ajoutez cette adresse dans CCTV Express comme caméra RTSP :', 'La caméra est arrêtée. Touchez Démarrer pour diffuser sur votre réseau.', 'Connectez le téléphone au même réseau Wi-Fi que l\u2019ordinateur.', 'Autorisez la caméra et le micro pour diffuser.', 'Ce téléphone n\u2019a pas pu démarrer l\u2019encodeur de la caméra.'],
  'values-de': ['CCTV Express Kamera', 'Live', 'Gestoppt', 'Starten', 'Stoppen', 'Kamera wechseln', 'Diese Adresse in CCTV Express als RTSP-Kamera hinzufügen:', 'Die Kamera ist gestoppt. Tippe auf Starten, um im Netzwerk zu senden.', 'Verbinde das Telefon mit demselben WLAN wie den Computer.', 'Erlaube Kamera und Mikrofon, um zu senden.', 'Dieses Telefon konnte den Kamera-Encoder nicht starten.'],
  'values-it': ['CCTV Express Camera', 'Dal vivo', 'Ferma', 'Avvia', 'Ferma', 'Cambia fotocamera', 'Aggiungi questo indirizzo in CCTV Express come telecamera RTSP:', 'La telecamera è ferma. Tocca Avvia per trasmettere sulla rete.', 'Collega il telefono alla stessa rete Wi-Fi del computer.', 'Consenti fotocamera e microfono per trasmettere.', 'Questo telefono non è riuscito ad avviare il codificatore.'],
  'values-nl': ['CCTV Express Camera', 'Live', 'Gestopt', 'Starten', 'Stoppen', 'Camera wisselen', 'Voeg dit adres in CCTV Express toe als RTSP-camera:', 'De camera is gestopt. Tik op Starten om op je netwerk uit te zenden.', 'Verbind de telefoon met hetzelfde wifi-netwerk als de computer.', 'Sta camera en microfoon toe om uit te zenden.', 'Deze telefoon kon de camera-encoder niet starten.'],
  'values-pl': ['CCTV Express Kamera', 'Na żywo', 'Zatrzymana', 'Start', 'Stop', 'Zmień kamerę', 'Dodaj ten adres w CCTV Express jako kamerę RTSP:', 'Kamera jest zatrzymana. Dotknij Start, aby nadawać w sieci.', 'Połącz telefon z tą samą siecią Wi-Fi co komputer.', 'Zezwól na kamerę i mikrofon, aby nadawać.', 'Ten telefon nie mógł uruchomić kodera kamery.'],
  'values-sv': ['CCTV Express Kamera', 'Live', 'Stoppad', 'Starta', 'Stoppa', 'Byt kamera', 'Lägg till den här adressen i CCTV Express som RTSP-kamera:', 'Kameran är stoppad. Tryck på Starta för att sända i nätverket.', 'Anslut telefonen till samma Wi-Fi som datorn.', 'Tillåt kamera och mikrofon för att sända.', 'Telefonen kunde inte starta kamerans kodare.'],
  'values-tr': ['CCTV Express Kamera', 'Canlı', 'Durduruldu', 'Başlat', 'Durdur', 'Kamerayı değiştir', 'Bu adresi CCTV Express\u2019e RTSP kamera olarak ekleyin:', 'Kamera durduruldu. Ağınızda yayın için Başlat\u2019a dokunun.', 'Telefonu bilgisayarla aynı Wi-Fi ağına bağlayın.', 'Yayın için kamera ve mikrofona izin verin.', 'Bu telefon kamera kodlayıcısını başlatamadı.'],
  'values-ru': ['CCTV Express Камера', 'В эфире', 'Остановлена', 'Старт', 'Стоп', 'Сменить камеру', 'Добавьте этот адрес в CCTV Express как RTSP-камеру:', 'Камера остановлена. Нажмите «Старт», чтобы вещать в сети.', 'Подключите телефон к той же сети Wi-Fi, что и компьютер.', 'Разрешите доступ к камере и микрофону для трансляции.', 'Телефону не удалось запустить кодировщик камеры.'],
  'values-ar': ['كاميرا CCTV Express', 'مباشر', 'متوقفة', 'بدء', 'إيقاف', 'تبديل الكاميرا', 'أضف هذا العنوان في CCTV Express ككاميرا RTSP:', 'الكاميرا متوقفة. اضغط بدء للبث على شبكتك.', 'صِل الهاتف بنفس شبكة Wi-Fi المتصل بها الكمبيوتر.', 'اسمح بالكاميرا والميكروفون للبث.', 'تعذّر على هذا الهاتف تشغيل مشفّر الكاميرا.'],
  'values-hi': ['CCTV Express कैमरा', 'लाइव', 'रुका हुआ', 'शुरू करें', 'रोकें', 'कैमरा बदलें', 'इस पते को CCTV Express में RTSP कैमरे के रूप में जोड़ें:', 'कैमरा रुका है। अपने नेटवर्क पर प्रसारण के लिए शुरू करें दबाएं।', 'फ़ोन को कंप्यूटर वाले ही Wi-Fi नेटवर्क से जोड़ें।', 'प्रसारण के लिए कैमरा और माइक्रोफ़ोन की अनुमति दें।', 'यह फ़ोन कैमरा एनकोडर शुरू नहीं कर सका।'],
  'values-in': ['CCTV Express Kamera', 'Langsung', 'Berhenti', 'Mulai', 'Berhenti', 'Ganti kamera', 'Tambahkan alamat ini di CCTV Express sebagai kamera RTSP:', 'Kamera berhenti. Ketuk Mulai untuk menyiarkan di jaringan Anda.', 'Hubungkan ponsel ke jaringan Wi-Fi yang sama dengan komputer.', 'Izinkan kamera dan mikrofon untuk menyiarkan.', 'Ponsel ini tidak dapat memulai encoder kamera.'],
  'values-vi': ['CCTV Express Camera', 'Trực tiếp', 'Đã dừng', 'Bắt đầu', 'Dừng', 'Đổi camera', 'Thêm địa chỉ này vào CCTV Express như camera RTSP:', 'Camera đã dừng. Chạm Bắt đầu để phát trong mạng của bạn.', 'Kết nối điện thoại với cùng mạng Wi-Fi với máy tính.', 'Cho phép camera và micro để phát.', 'Điện thoại này không khởi động được bộ mã hóa camera.'],
  'values-ja': ['CCTV Express カメラ', 'ライブ', '停止中', '開始', '停止', 'カメラ切替', 'このアドレスを CCTV Express に RTSP カメラとして追加してください:', 'カメラは停止中です。ネットワークで配信するには「開始」をタップします。', 'スマートフォンをパソコンと同じ Wi-Fi に接続してください。', '配信するにはカメラとマイクを許可してください。', 'このスマートフォンではカメラのエンコーダーを開始できませんでした。'],
  'values-ko': ['CCTV Express 카메라', '라이브', '중지됨', '시작', '중지', '카메라 전환', '이 주소를 CCTV Express에 RTSP 카메라로 추가하세요:', '카메라가 중지되었습니다. 네트워크로 송출하려면 시작을 누르세요.', '휴대폰을 컴퓨터와 같은 Wi-Fi에 연결하세요.', '송출하려면 카메라와 마이크를 허용하세요.', '이 휴대폰에서 카메라 인코더를 시작하지 못했습니다.'],
  'values-zh-rCN': ['CCTV Express 摄像头', '直播', '已停止', '开始', '停止', '切换摄像头', '请在 CCTV Express 中将此地址添加为 RTSP 摄像头：', '摄像头已停止。点按“开始”在网络中推流。', '请将手机连接到与电脑相同的 Wi-Fi。', '请允许使用摄像头和麦克风以推流。', '此手机无法启动摄像头编码器。'],
};
// o usuário e a senha da câmera, mostrados na tela para cadastrar no computador
const C = {
  values: 'User: %1$s · Password: %2$s', 'values-pt': 'Usuário: %1$s · Senha: %2$s', 'values-es': 'Usuario: %1$s · Contraseña: %2$s',
  'values-fr': 'Utilisateur : %1$s · Mot de passe : %2$s', 'values-de': 'Benutzer: %1$s · Passwort: %2$s', 'values-it': 'Utente: %1$s · Password: %2$s',
  'values-nl': 'Gebruiker: %1$s · Wachtwoord: %2$s', 'values-pl': 'Użytkownik: %1$s · Hasło: %2$s', 'values-sv': 'Användare: %1$s · Lösenord: %2$s',
  'values-tr': 'Kullanıcı: %1$s · Parola: %2$s', 'values-ru': 'Пользователь: %1$s · Пароль: %2$s', 'values-ar': 'المستخدم: %1$s · كلمة المرور: %2$s',
  'values-hi': 'उपयोगकर्ता: %1$s · पासवर्ड: %2$s', 'values-in': 'Pengguna: %1$s · Kata sandi: %2$s', 'values-vi': 'Người dùng: %1$s · Mật khẩu: %2$s',
  'values-ja': 'ユーザー: %1$s · パスワード: %2$s', 'values-ko': '사용자: %1$s · 비밀번호: %2$s', 'values-zh-rCN': '用户：%1$s · 密码：%2$s',
};
for (const d of Object.keys(T)) T[d].push(C[d]);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'").replace(/"/g, '\\"');
for (const [d, v] of Object.entries(T)) {
  fs.mkdirSync(path.join(base, d), { recursive: true });
  const linhas = K.map((k, i) => `  <string name="${k}">${esc(v[i])}</string>`).join('\n');
  fs.writeFileSync(path.join(base, d, 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${linhas}\n</resources>\n`);
}
console.log(`${Object.keys(T).length} idiomas`);
