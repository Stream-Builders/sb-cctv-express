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
      .put("credenciais", if (url.isEmpty()) "" else getString(R.string.credenciais, USUARIO, senha()))
      .toString()
  }

  /** a ponte da tela (painel.html) para o app */
  inner class Ponte {
    @JavascriptInterface fun estado(): String = estadoJson()
    @JavascriptInterface fun textos(): String = JSONObject().apply {
      for ((k, id) in listOf("ao_vivo" to R.string.ao_vivo, "parado" to R.string.parado, "iniciar" to R.string.iniciar,
        "parar" to R.string.parar, "trocar" to R.string.trocar, "luz" to R.string.luz, "escurecer" to R.string.escurecer)) put(k, getString(id))
    }.toString()
    @JavascriptInterface fun acao(qual: String) {
      runOnUiThread {
        when (qual) {
          "alternar" -> alternar()
          "trocar" -> (stream?.videoSource as? Camera2Source)?.switchCamera()
          "luz" -> definirLuz(!lanternaAcesa())
          "escurecer" -> escurecerTela(true)
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
    s.getStreamClient().setAuthorization(USUARIO, senha())
    // o endereço da rede de casa (192.168.x.x), não o IPv6 que o Android sorteia
    s.getStreamClient().forceIpType(com.pedro.rtspserver.server.IpType.IPv4)
    val ok = try {
      s.prepareVideo(LARGURA, ALTURA, TAXA_VIDEO) && s.prepareAudio(32000, false, 64_000)
    } catch (_: IllegalArgumentException) { false }
    if (!ok) { Toast.makeText(this, R.string.falha, Toast.LENGTH_LONG).show(); return }
    stream = s
    tela.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) { if (!s.isOnPreview) s.startPreview(tela) }
      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        s.getGlInterface().setPreviewResolution(width, height)
      }
      override fun surfaceDestroyed(holder: SurfaceHolder) { if (s.isOnPreview) s.stopPreview() }
    })
    if (tela.holder.surface?.isValid == true && !s.isOnPreview) s.startPreview(tela)
    // o computador controla a luz pela rede, com o mesmo usuário e senha do vídeo
    controle = Controle(PORTA_CONTROLE, USUARIO, senha(), this).also { it.iniciar() }
    // aberto o app, o celular já é uma câmera
    alternar()
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

  override fun onDestroy() {
    super.onDestroy()
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
