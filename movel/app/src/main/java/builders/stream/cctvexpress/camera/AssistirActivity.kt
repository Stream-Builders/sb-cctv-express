// Assistir câmeras da rede, como no CCTV Express do computador: mosaico ao vivo, uma câmera em tela cheia (com som),
// adicionar por ONVIF, RTSP ou Xiongmai/iCSee, busca na rede e o arquivo de configuração rápida (.cctvx).
// A tela (botões, nomes, formulários) é HTML por cima; o vídeo é o player nativo do Android (Media3, RTSP), um por
// quadro, posicionado onde a tela HTML manda. O mosaico usa o vídeo secundário (leve) e a tela cheia o principal.
package builders.stream.cctvexpress.camera

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AssistirActivity : Activity() {

  private companion object {
    const val PEDIDO_EXPORTAR = 11
    const val PEDIDO_IMPORTAR = 12
  }

  private lateinit var cameras: Cameras
  private lateinit var palco: FrameLayout
  private lateinit var tela: WebView
  private val principal = Handler(Looper.getMainLooper())

  /** Um quadro do mosaico: a caixa na posição que a tela pediu, o vídeo encaixado nela sem esticar e o player. */
  private inner class Quadro(val id: String) {
    val caixa = FrameLayout(this@AssistirActivity).apply { setBackgroundColor(Color.BLACK) }
    val video = SurfaceView(this@AssistirActivity)
    var player: ExoPlayer? = null
    var endereco: String? = null
    var tentativas = 0
    var proporcao = 16f / 9f
    var som = false
    var desdeBuffer = 0L
    val religar = Runnable { conectar() }

    init {
      caixa.addView(video, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
      palco.addView(caixa, 0)
    }

    fun posicionar(x: Int, y: Int, w: Int, h: Int) {
      caixa.layoutParams = FrameLayout.LayoutParams(w, h).apply { leftMargin = x; topMargin = y }
      encaixar(w, h)
    }

    /** o vídeo cabe inteiro no quadro, com faixas pretas, sem distorcer */
    fun encaixar(w: Int = caixa.layoutParams?.width ?: 0, h: Int = caixa.layoutParams?.height ?: 0) {
      if (w <= 0 || h <= 0) return
      val (vw, vh) = if (w.toFloat() / h > proporcao) Pair((h * proporcao).toInt(), h) else Pair(w, (w / proporcao).toInt())
      video.layoutParams = FrameLayout.LayoutParams(vw, vh, Gravity.CENTER)
    }

    fun tocar(url: String, comSom: Boolean) {
      som = comSom
      player?.volume = if (som) 1f else 0f
      if (url == endereco && player != null) return
      endereco = url
      tentativas = 0
      conectar()
    }

    fun conectar() {
      principal.removeCallbacks(religar)
      val url = endereco ?: return
      avisar(id, "conectando")
      val p = player ?: ExoPlayer.Builder(this@AssistirActivity)
        // ao vivo: pouco buffer, para a imagem chegar logo e não atrasar
        .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(500, 3000, 250, 500).build())
        .build().also { novo ->
          player = novo
          novo.setVideoSurfaceView(video)
          novo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(estado: Int) {
              when (estado) {
                Player.STATE_READY -> { tentativas = 0; desdeBuffer = 0; avisar(id, "vivo") }
                Player.STATE_BUFFERING -> { desdeBuffer = System.currentTimeMillis(); avisar(id, "conectando") }
                // a câmera encerrou a transmissão: volta a pedir
                Player.STATE_ENDED -> falhou()
                else -> {}
              }
            }
            override fun onPlayerError(error: PlaybackException) = falhou()
            override fun onVideoSizeChanged(tamanho: VideoSize) {
              if (tamanho.width > 0 && tamanho.height > 0) {
                proporcao = tamanho.width * tamanho.pixelWidthHeightRatio / tamanho.height
                encaixar()
              }
            }
          })
        }
      // RTP dentro da própria conexão RTSP (TCP): passa por qualquer Wi-Fi, sem portas UDP
      val fonte = RtspMediaSource.Factory().setForceUseRtpTcp(true).setTimeoutMs(8000).createMediaSource(MediaItem.fromUri(Uri.parse(url)))
      p.setMediaSource(fonte)
      p.volume = if (som) 1f else 0f
      p.playWhenReady = true
      p.prepare()
    }

    /** caiu: tenta de novo em 2, 4, 8... até 30 s, para sempre, como no computador */
    fun falhou() {
      avisar(id, "semSinal")
      principal.removeCallbacks(religar)
      val espera = minOf(30_000L, 2_000L shl minOf(tentativas, 4))
      tentativas++
      principal.postDelayed(religar, espera)
    }

    fun soltar() {
      principal.removeCallbacks(religar)
      player?.release()
      player = null
      palco.removeView(caixa)
    }
  }

  private val quadros = mutableMapOf<String, Quadro>()
  private var ultimoLayout = "[]"
  private var visivel = false
  private var exportando: String? = null
  private var textoImportado: String? = null

  // um quadro que segue "conectando" por mais de 20 s é reconectado (a câmera parou de mandar sem fechar a conexão)
  private val vigia = object : Runnable {
    override fun run() {
      val agora = System.currentTimeMillis()
      for (q in quadros.values) if (q.desdeBuffer > 0 && agora - q.desdeBuffer > 20_000) { q.desdeBuffer = 0; q.falhou() }
      principal.postDelayed(this, 5_000)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    cameras = Cameras(this)
    palco = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    tela = Web.criar(this, Ponte(), "Assistir", "assistir.html")
    palco.addView(tela, FrameLayout.LayoutParams(-1, -1))
    setContentView(palco)
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { voltar() }
    }
  }

  @Deprecated("Android 12 ou anterior")
  override fun onBackPressed() { voltar() }

  /** voltar fecha o que estiver aberto na tela (formulário, tela cheia); sem nada aberto, volta à escolha do modo */
  private fun voltar() {
    tela.evaluateJavascript("window.voltar ? voltar() : false") { r -> if (r != "true") irParaInicio() }
  }

  private fun irParaInicio() {
    startActivity(Intent(this, InicioActivity::class.java).putExtra(InicioActivity.ESCOLHER, true))
    finish()
  }

  override fun onStart() {
    super.onStart()
    visivel = true
    aplicarLayout(ultimoLayout)
    principal.postDelayed(vigia, 5_000)
  }

  // fora da tela não gasta rede nem bateria: os players são soltos e voltam ao abrir
  override fun onStop() {
    super.onStop()
    visivel = false
    principal.removeCallbacks(vigia)
    quadros.values.forEach { it.soltar() }
    quadros.clear()
  }

  private fun avisar(id: String, estado: String) {
    principal.post { tela.evaluateJavascript("window.estadoCamera && estadoCamera(${Web.js(id)}, '$estado')", null) }
  }

  private fun chamarTela(funcao: String, dado: String) {
    principal.post { tela.evaluateJavascript("window.$funcao && $funcao($dado)", null) }
  }

  /** a tela manda onde fica cada quadro (em pixels físicos) e se é o vídeo principal (tela cheia) e com som */
  private fun aplicarLayout(json: String) {
    ultimoLayout = json
    if (!visivel) return
    val pedidos = try { JSONArray(json) } catch (_: Exception) { JSONArray() }
    val todas = cameras.ler().associateBy { it.optString("id") }
    val vistos = mutableSetOf<String>()
    for (k in 0 until pedidos.length()) {
      val p = pedidos.getJSONObject(k)
      val id = p.optString("id")
      val c = todas[id] ?: continue
      val url = cameras.enderecoParaTocar(c, secundario = !p.optBoolean("principal")) ?: continue
      vistos += id
      val q = quadros.getOrPut(id) { Quadro(id) }
      q.posicionar(p.optInt("x"), p.optInt("y"), p.optInt("w"), p.optInt("h"))
      q.tocar(url, p.optBoolean("som"))
    }
    for (id in quadros.keys - vistos) quadros.remove(id)?.soltar()
  }

  private fun lerArquivo(uri: Uri): String? = try {
    contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) }
  } catch (_: Exception) { null }

  @Deprecated("startActivityForResult serve sem a biblioteca de Activity Result")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    val uri = data?.data
    when (requestCode) {
      PEDIDO_EXPORTAR -> {
        val conteudo = exportando
        exportando = null
        if (resultCode != RESULT_OK || uri == null || conteudo == null) return
        val ok = try { contentResolver.openOutputStream(uri, "wt")?.use { it.write(conteudo.toByteArray(Charsets.UTF_8)) } != null } catch (_: Exception) { false }
        chamarTela("exportado", ok.toString())
      }
      PEDIDO_IMPORTAR -> {
        if (resultCode != RESULT_OK || uri == null) return
        val texto = lerArquivo(uri) ?: return chamarTela("importado", JSONObject().put("erro", "invalido").toString())
        textoImportado = texto
        if (Arquivo.cifrado(texto)) chamarTela("pedirSenhaArquivo", "") else importarCom("")
      }
    }
  }

  private fun importarCom(senha: String) {
    val texto = textoImportado ?: return
    thread {
      val r = try {
        val conteudo = Arquivo.ler(texto, senha)
        textoImportado = null
        val novas = cameras.importar(conteudo.optJSONArray("cameras") ?: JSONArray())
        JSONObject().put("novas", novas)
      } catch (_: Arquivo.SenhaErrada) { JSONObject().put("erro", "senha") } catch (_: Exception) { JSONObject().put("erro", "invalido") }
      chamarTela("importado", r.toString())
      // câmeras vindas do computador sem o endereço do vídeo (Xiongmai, ONVIF): o celular pergunta a cada uma
      if (r.has("novas")) {
        for (c in cameras.ler().filter { cameras.precisaResolver(it) }) {
          cameras.resolver(c)
          chamarTela("recarregar", "")
        }
      }
    }
  }

  /** a ponte da tela (assistir.html) para o app */
  inner class Ponte {
    @JavascriptInterface fun listar(): String = cameras.listar().toString()
    @JavascriptInterface fun posicionar(json: String) { principal.post { aplicarLayout(json) } }
    @JavascriptInterface fun salvar(json: String) {
      thread {
        val r = try { cameras.salvar(JSONObject(json)) } catch (_: Exception) { JSONObject().put("erro", "caminho") }
        chamarTela("salvo", r.toString())
        // o endereço pode ter mudado: o quadro reconecta
        principal.post { quadros.remove(r.optString("id"))?.soltar(); aplicarLayout(ultimoLayout) }
      }
    }
    @JavascriptInterface fun remover(id: String) {
      cameras.remover(id)
      principal.post { quadros.remove(id)?.soltar() }
    }
    @JavascriptInterface fun detectar() {
      thread {
        val ja = cameras.ler().map { it.optString("ip") }.toSet()
        val lista = Descoberta.detectar(this@AssistirActivity)
        for (k in 0 until lista.length()) lista.getJSONObject(k).let { it.put("jaAdicionada", it.optString("ip") in ja) }
        chamarTela("detectado", lista.toString())
      }
    }
    @JavascriptInterface fun exportar(senha: String) {
      thread {
        val conteudo = JSONObject().put("origem", "android").put("criado", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US).format(java.util.Date()))
          .put("cameras", cameras.paraExportar(comSenha = senha.isNotEmpty()))
        exportando = Arquivo.montar(conteudo, senha)
        principal.post {
          val nome = "cctv-express-" + java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date()) + ".cctvx"
          @Suppress("DEPRECATION")
          startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, nome), PEDIDO_EXPORTAR)
        }
      }
    }
    @JavascriptInterface fun importar() {
      principal.post {
        @Suppress("DEPRECATION")
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), PEDIDO_IMPORTAR)
      }
    }
    @JavascriptInterface fun senhaDoArquivo(senha: String) = importarCom(senha)
    @JavascriptInterface fun inicio() { principal.post { irParaInicio() } }
  }
}
