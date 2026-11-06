// O CCTV Express Câmera: a câmera do celular vira uma câmera IP na rede local. O vídeo sai por RTSP
// (rtsp://<ip do celular>:8554/), e o CCTV Express no computador adiciona esse endereço como câmera RTSP.
// Nada passa por servidor de terceiros: o vídeo vai do celular direto para o computador, na mesma rede.
package builders.stream.cctvexpress.camera

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.rtspserver.RtspServerStream

class MainActivity : Activity(), ConnectChecker {

  private companion object {
    const val PORTA = 8554
    const val USUARIO = "admin"
    const val LARGURA = 1280
    const val ALTURA = 720
    const val TAXA_VIDEO = 2_500_000
    const val PEDIDO_PERMISSAO = 1
    const val ACENTO = 0xFFFF3333.toInt()
    const val VIVO = 0xFF22C55E.toInt()
    const val TEXTO_SUAVE = 0xFFD1D5DB.toInt()
    const val VEU = 0xB3000000.toInt()
  }

  private var stream: RtspServerStream? = null
  private lateinit var tela: SurfaceView
  private lateinit var selo: TextView
  private lateinit var endereco: TextView
  private lateinit var ajuda: TextView
  private lateinit var credenciais: TextView
  private lateinit var botao: Button

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
    if (temPermissoes()) preparar() else ajuda.text = getString(R.string.permissao)
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private fun caixa(cor: Int, borda: Int) = GradientDrawable().apply {
    setColor(cor); cornerRadius = dp(3).toFloat(); setStroke(dp(1), borda)
  }

  private fun montarTela() {
    val raiz = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    tela = SurfaceView(this)
    raiz.addView(tela, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))

    // a faixa de cima: a marca e o selo de estado, como no quadro do CCTV Express
    val topo = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(16), dp(10), dp(16), dp(10)); setBackgroundColor(VEU)
    }
    val marca = TextView(this).apply {
      text = getString(R.string.app_nome); setTextColor(Color.WHITE); textSize = 16f; typeface = Typeface.DEFAULT_BOLD
    }
    selo = TextView(this).apply {
      textSize = 12f; typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.08f; isAllCaps = true
      setPadding(dp(10), dp(3), dp(10), dp(3))
    }
    topo.addView(marca, LinearLayout.LayoutParams(0, -2, 1f))
    topo.addView(selo)
    raiz.addView(topo, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

    // a faixa de baixo: o endereço para adicionar no computador e as ações
    val base = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
      // embaixo, o espaço da barra de gestos do Android, para os botões não ficarem cortados
      setPadding(dp(16), dp(10), dp(16), dp(28)); setBackgroundColor(VEU)
    }
    ajuda = TextView(this).apply { setTextColor(TEXTO_SUAVE); textSize = 13f; gravity = Gravity.CENTER }
    endereco = TextView(this).apply {
      setTextColor(ACENTO); textSize = 20f; typeface = Typeface.MONOSPACE; gravity = Gravity.CENTER
      setTextIsSelectable(true)
    }
    val linha = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    botao = Button(this).apply {
      setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD; isAllCaps = true
      background = caixa(ACENTO, ACENTO); setPadding(dp(22), 0, dp(22), 0)
      setOnClickListener { alternar() }
    }
    val trocar = Button(this).apply {
      text = getString(R.string.trocar); setTextColor(Color.WHITE); isAllCaps = true
      background = caixa(0xFF1F2329.toInt(), 0xFF4B5563.toInt()); setPadding(dp(18), 0, dp(18), 0)
      setOnClickListener { (stream?.videoSource as? Camera2Source)?.switchCamera() }
    }
    linha.addView(botao, LinearLayout.LayoutParams(-2, dp(44)).apply { marginEnd = dp(10) })
    linha.addView(trocar, LinearLayout.LayoutParams(-2, dp(44)))
    credenciais = TextView(this).apply {
      setTextColor(Color.WHITE); textSize = 14f; typeface = Typeface.MONOSPACE; gravity = Gravity.CENTER
      setTextIsSelectable(true)
    }
    base.addView(ajuda)
    base.addView(endereco)
    base.addView(credenciais)
    base.addView(linha, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
    raiz.addView(base, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    setContentView(raiz)
    mostrarEstado()
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
    if (!ok) { ajuda.text = getString(R.string.falha); return }
    stream = s
    tela.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) { if (!s.isOnPreview) s.startPreview(tela) }
      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        s.getGlInterface().setPreviewResolution(width, height)
      }
      override fun surfaceDestroyed(holder: SurfaceHolder) { if (s.isOnPreview) s.stopPreview() }
    })
    if (tela.holder.surface?.isValid == true && !s.isOnPreview) s.startPreview(tela)
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
    val s = stream
    val aoVivo = s?.isStreaming == true
    selo.text = getString(if (aoVivo) R.string.ao_vivo else R.string.parado)
    selo.background = if (aoVivo) caixa(0xFF052E16.toInt(), 0xFF166534.toInt()) else caixa(0xFF1F2329.toInt(), 0xFF4B5563.toInt())
    selo.setTextColor(if (aoVivo) VIVO else TEXTO_SUAVE)
    botao.text = getString(if (aoVivo) R.string.parar else R.string.iniciar)
    if (s != null && aoVivo) {
      val url = s.getStreamClient().getEndPointConnection()
      val semRede = url.isBlank() || url.contains("0.0.0.0") || url.contains("127.0.0.1")
      ajuda.text = getString(if (semRede) R.string.sem_rede else R.string.endereco)
      endereco.text = if (semRede) "" else url
      endereco.visibility = if (semRede) View.GONE else View.VISIBLE
      credenciais.text = getString(R.string.credenciais, USUARIO, senha())
      credenciais.visibility = endereco.visibility
    } else {
      ajuda.text = getString(R.string.parado_ajuda)
      endereco.visibility = View.GONE
      credenciais.visibility = View.GONE
    }
  }

  override fun onDestroy() {
    super.onDestroy()
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
