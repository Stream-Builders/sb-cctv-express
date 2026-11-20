// O CCTV Express Câmera: a câmera do celular vira uma câmera IP na rede local. O vídeo sai por RTSP
// (rtsp://<ip do celular>:8554/), e o CCTV Express no computador adiciona esse endereço como câmera RTSP.
// Nada passa por servidor de terceiros: o vídeo vai do celular direto para o computador, na mesma rede.
package builders.stream.cctvexpress.camera

import android.Manifest
import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import android.widget.Toast
import org.json.JSONObject
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.rtspserver.RtspServerStream
import com.pedro.encoder.input.gl.render.filters.`object`.TextObjectFilterRender
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity(), ConnectChecker {

  private companion object {
    const val PORTA = 8554
    const val PORTA_CONTROLE = 8555
    const val USUARIO = "admin"
    const val LARGURA = 1280
    const val ALTURA = 720
    const val TAXA_VIDEO = 2_500_000
    const val PEDIDO_PERMISSAO = 1
  }

  private var stream: RtspServerStream? = null
  // o Wi-Fi sem economia de energia e o processador acordado enquanto a câmera transmite: com a economia, o celular
  // segurava os pacotes e o vídeo chegava no computador em rajadas (travando e correndo)
  private var travaWifi: WifiManager.WifiLock? = null
  private var travaCpu: PowerManager.WakeLock? = null
  private val relogio = Handler(Looper.getMainLooper())
  private var dataHora: TextObjectFilterRender? = null
  private val formatoDataHora by lazy { SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault()) }
  private val tique = object : Runnable {
    override fun run() {
      dataHora?.let { escreverDataHora(it) }
      relogio.postDelayed(this, 1000 - System.currentTimeMillis() % 1000)
    }
  }
  private lateinit var tela: SurfaceView
  private lateinit var cortina: TextView

  private fun escurecerTela(escuro: Boolean) {
    cortina.visibility = if (escuro) View.VISIBLE else View.GONE
    window.attributes = window.attributes.apply {
      screenBrightness = if (escuro) 0.01f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // a câmera fica ligada como uma câmera de verdade: a tela não apaga enquanto o app está aberto
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    segurarRede()
    montarTela()
    if (temPermissoes()) preparar()
    else requestPermissions(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO), PEDIDO_PERMISSAO)
  }

  private fun temPermissoes() =
    checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
      checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (temPermissoes()) preparar() else Toast.makeText(this, R.string.permissao, Toast.LENGTH_LONG).show()
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private lateinit var painel: WebView
  private var controle: Controle? = null

  private fun lanternaAcesa(): Boolean = try { (stream?.videoSource as? Camera2Source)?.isLanternEnabled() == true } catch (_: Exception) { false }

  /** acende ou apaga a lanterna; vale para o botão da tela e para o pedido do computador */
  fun definirLuz(acesa: Boolean): Boolean {
    val fonte = stream?.videoSource as? Camera2Source ?: return false
    try { if (acesa) fonte.enableLantern() else fonte.disableLantern() } catch (_: Exception) { /* câmera sem lanterna */ }
    runOnUiThread { mostrarEstado() }
    return lanternaAcesa()
  }

  fun estadoJson(): String {
    val s = stream
    val aoVivo = s?.isStreaming == true
    var ajudaTxt = getString(R.string.parado_ajuda)
    var url = ""
    if (s != null && aoVivo) {
      val u = s.getStreamClient().getEndPointConnection()
      val semRede = u.isBlank() || u.contains("0.0.0.0") || u.contains("127.0.0.1")
      ajudaTxt = getString(if (semRede) R.string.sem_rede else R.string.endereco)
      if (!semRede) url = u
    }
    return JSONObject()
      .put("aoVivo", aoVivo).put("luz", lanternaAcesa()).put("ajuda", ajudaTxt).put("endereco", url)
      .put("credenciais", if (url.isEmpty()) "" else getString(R.string.credenciais, usuario(), senha()))
      .toString()
  }

  /** a ponte da tela (painel.html) para o app */
  inner class Ponte {
    @JavascriptInterface fun estado(): String = estadoJson()
    @JavascriptInterface fun textos(): String = JSONObject().apply {
      for ((k, id) in listOf("ao_vivo" to R.string.ao_vivo, "parado" to R.string.parado, "iniciar" to R.string.iniciar,
        "parar" to R.string.parar, "trocar" to R.string.trocar, "luz" to R.string.luz, "escurecer" to R.string.escurecer,
        "datahora" to R.string.datahora, "inicio" to R.string.inicio)) put(k, getString(id))
    }.toString()
    @JavascriptInterface fun dataHora(): Boolean = dataHoraLigada()
    @JavascriptInterface fun acesso(): String = JSONObject().put("usuario", usuario()).put("senha", senha()).toString()
    @JavascriptInterface fun salvarAcesso(u: String, p: String): Boolean = this@MainActivity.salvarAcesso(u, p)
    @JavascriptInterface fun acao(qual: String) {
      runOnUiThread {
        when (qual) {
          "alternar" -> alternar()
          "trocar" -> (stream?.videoSource as? Camera2Source)?.switchCamera()
          "luz" -> definirLuz(!lanternaAcesa())
          "escurecer" -> escurecerTela(true)
          "datahora" -> definirDataHora(!dataHoraLigada())
          "inicio" -> {
            startActivity(Intent(this@MainActivity, InicioActivity::class.java).putExtra(InicioActivity.ESCOLHER, true))
            finish()
          }
        }
        mostrarEstado()
      }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun montarTela() {
    val raiz = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    tela = SurfaceView(this)
    raiz.addView(tela, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
    // a tela por cima do vídeo é HTML com a peça .sb-btn de verdade (o mesmo CSS do CCTV Express do computador)
    painel = WebView(this).apply {
      setBackgroundColor(Color.TRANSPARENT)
      settings.javaScriptEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      addJavascriptInterface(Ponte(), "Camera")
      val carregador = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this@MainActivity)).build()
      webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
          carregador.shouldInterceptRequest(request.url)
      }
      loadUrl("https://appassets.androidplatform.net/assets/painel.html")
    }
    raiz.addView(painel, FrameLayout.LayoutParams(-1, -1))
    // a tela escura: cobre tudo de preto e baixa o brilho ao mínimo; a câmera continua transmitindo. Um toque acende.
    cortina = TextView(this).apply {
      setBackgroundColor(Color.BLACK); setTextColor(0xFF2A2A2A.toInt()); textSize = 12f; gravity = Gravity.CENTER
      text = getString(R.string.escuro_aviso); visibility = View.GONE
      setOnClickListener { escurecerTela(false) }
    }
    raiz.addView(cortina, FrameLayout.LayoutParams(-1, -1))
    setContentView(raiz)
  }

  private fun preparar() {
    val s = RtspServerStream(this, PORTA, this)
    s.getGlInterface().autoHandleOrientation = true
    // só quem tem a senha vê a câmera: o usuário é "admin" (o padrão do CCTV Express) e a senha é sorteada na
    // primeira vez e guardada no celular
    s.getStreamClient().setAuthorization(usuario(), senha())
    // o endereço da rede de casa (192.168.x.x), não o IPv6 que o Android sorteia
    s.getStreamClient().forceIpType(com.pedro.rtspserver.server.IpType.IPv4)
    val ok = try {
      s.prepareVideo(LARGURA, ALTURA, 30, TAXA_VIDEO, 1, 0) && s.prepareAudio(32000, false, 64_000)
    } catch (_: IllegalArgumentException) { false }
    if (!ok) { Toast.makeText(this, R.string.falha, Toast.LENGTH_LONG).show(); return }
    stream = s
    if (dataHoraLigada()) definirDataHora(true)
    tela.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) { if (!s.isOnPreview) s.startPreview(tela) }
      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        s.getGlInterface().setPreviewResolution(width, height)
      }
      override fun surfaceDestroyed(holder: SurfaceHolder) { if (s.isOnPreview) s.stopPreview() }
    })
    if (tela.holder.surface?.isValid == true && !s.isOnPreview) s.startPreview(tela)
    // o computador controla a luz pela rede, com o mesmo usuário e senha do vídeo
    controle = Controle(PORTA_CONTROLE, usuario(), senha(), this).also { it.iniciar() }
    // aberto o app, o celular já é uma câmera
    alternar()
  }

  private fun usuario(): String = getSharedPreferences("camera", MODE_PRIVATE).getString("usuario", null) ?: USUARIO

  /** a pessoa escolhe o usuário e a senha: valem na hora para o vídeo (RTSP) e para o controle da luz */
  fun salvarAcesso(u: String, p: String): Boolean {
    val usuarioNovo = u.trim()
    if (usuarioNovo.isEmpty() || p.length < 4 || usuarioNovo.contains(':')) return false
    getSharedPreferences("camera", MODE_PRIVATE).edit().putString("usuario", usuarioNovo).putString("senha", p).apply()
    stream?.getStreamClient()?.setAuthorization(usuarioNovo, p)
    controle?.parar()
    controle = Controle(PORTA_CONTROLE, usuarioNovo, p, this).also { it.iniciar() }
    runOnUiThread { mostrarEstado() }
    return true
  }

  private fun senha(): String {
    val prefs = getSharedPreferences("camera", MODE_PRIVATE)
    prefs.getString("senha", null)?.let { return it }
    val letras = "abcdefghjkmnpqrstuvwxyz23456789"
    val aleatorio = java.security.SecureRandom()
    val nova = (1..10).map { letras[aleatorio.nextInt(letras.length)] }.joinToString("")
    prefs.edit().putString("senha", nova).apply()
    return nova
  }

  private fun alternar() {
    val s = stream ?: return
    if (s.isStreaming) s.stopStream() else s.startStream()
    mostrarEstado()
  }

  private fun mostrarEstado() {
    if (!::painel.isInitialized) return
    painel.evaluateJavascript("window.atualizar && atualizar(${estadoJson()})", null)
  }

  private fun segurarRede() {
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    @Suppress("DEPRECATION")
    val modo = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
    travaWifi = wifi.createWifiLock(modo, "cctv-express:camera").apply { setReferenceCounted(false); acquire() }
    val energia = getSystemService(Context.POWER_SERVICE) as PowerManager
    travaCpu = energia.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cctv-express:camera").apply { setReferenceCounted(false); acquire() }
  }

  private fun dataHoraLigada() = getSharedPreferences("camera", MODE_PRIVATE).getBoolean("dataHora", true)

  /** a data e a hora gravadas na imagem, no canto de cima, como nas câmeras IP (vale para o vídeo que vai ao computador) */
  private fun definirDataHora(ligar: Boolean) {
    getSharedPreferences("camera", MODE_PRIVATE).edit().putBoolean("dataHora", ligar).apply()
    val gl = stream?.getGlInterface() ?: return
    relogio.removeCallbacks(tique)
    dataHora?.let { try { gl.removeFilter(it) } catch (_: Exception) {} }
    dataHora = null
    if (!ligar) return
    val f = TextObjectFilterRender()
    escreverDataHora(f)
    gl.addFilter(f)
    dataHora = f
    relogio.post(tique)
  }

  private fun escreverDataHora(f: TextObjectFilterRender) {
    val texto = " " + formatoDataHora.format(Date()) + " "
    f.setText(texto, 40f, Color.WHITE, 0x73000000)
    // a escala é em % do quadro: a largura acompanha o tamanho do texto, com a altura na proporção da imagem
    val pincel = android.graphics.Paint().apply { textSize = 40f }
    val proporcao = pincel.measureText(texto) / (pincel.fontMetrics.bottom - pincel.fontMetrics.top)
    val largura = 34f
    f.setScale(largura, largura * LARGURA / ALTURA / proporcao)
    f.setPosition(1.5f, 2f)
  }

  override fun onDestroy() {
    super.onDestroy()
    relogio.removeCallbacks(tique)
    try { travaWifi?.release() } catch (_: Exception) {}
    try { travaCpu?.release() } catch (_: Exception) {}
    controle?.parar()
    stream?.let {
      if (it.isStreaming) it.stopStream()
      if (it.isOnPreview) it.stopPreview()
      it.release()
    }
  }

  // o servidor RTSP avisa quando um computador conecta ou sai
  override fun onConnectionStarted(url: String) {}
  override fun onConnectionSuccess() { runOnUiThread { mostrarEstado() } }
  override fun onConnectionFailed(reason: String) { runOnUiThread { mostrarEstado() } }
  override fun onDisconnect() { runOnUiThread { mostrarEstado() } }
  override fun onAuthError() {}
  override fun onAuthSuccess() {}
}
