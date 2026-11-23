// Assistir câmeras da rede, como no CCTV Express do computador: mosaico ao vivo, uma câmera em tela cheia (com som),
// adicionar por ONVIF, RTSP ou Xiongmai/iCSee, busca na rede e o arquivo de configuração rápida (.cctvx).
// A tela (botões, nomes, formulários) é HTML por cima; o vídeo é decodificado pelo próprio aparelho (MediaCodec), um por
// quadro, posicionado onde a tela HTML manda, vindo por RTSP (FonteRtsp) ou pelo protocolo da Xiongmai (FonteDvrip).
// O mosaico usa o vídeo secundário (leve) e a tela cheia o principal. O zoom digital amplia a imagem de cada quadro.
package builders.stream.cctvexpress.camera

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

class AssistirActivity : Activity() {

  private companion object {
    const val PEDIDO_EXPORTAR = 11
    const val PEDIDO_IMPORTAR = 12
  }

  private lateinit var cameras: Cameras
  private lateinit var palco: FrameLayout
  private lateinit var tela: WebView
  private val principal = Handler(Looper.getMainLooper())

  /**
   * Um quadro do mosaico: a caixa na posição que a tela pediu, o vídeo encaixado nela sem esticar (ampliado pelo zoom
   * digital, quando houver) e a conexão com a câmera, numa linha de execução própria.
   */
  private inner class Quadro(val id: String) : TextureView.SurfaceTextureListener {
    val caixa = FrameLayout(this@AssistirActivity).apply { setBackgroundColor(Color.BLACK) }
    val video = TextureView(this@AssistirActivity)
    var plano: Cameras.Plano? = null
    var principalPedido = false
    var tentativas = 0
    var proporcao = 16f / 9f
    @Volatile var som = false
    var estado = ""
    var desde = 0L
    var ultimoQuadro = 0L
    var zoom = 1f
    var zx = .5f
    var zy = .5f
    private var superficie: Surface? = null
    private var fonte: Fonte? = null
    private var trabalho: Thread? = null
    private var geracao = 0
    private var agendado = false
    val religar = Runnable { agendado = false; conectar() }

    init {
      video.surfaceTextureListener = this
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
      aplicarZoom(vw, vh)
    }

    /** zoom digital: amplia a imagem em volta do ponto (zx, zy), de 0 a 1 na imagem, sem sair dela */
    fun aplicarZoom(w: Int = video.layoutParams?.width ?: 0, h: Int = video.layoutParams?.height ?: 0) {
      if (w <= 0 || h <= 0) return
      val z = zoom.coerceIn(1f, 8f)
      val cx = zx.coerceIn(.5f / z, 1 - .5f / z)
      val cy = zy.coerceIn(.5f / z, 1 - .5f / z)
      video.setTransform(Matrix().apply { setScale(z, z); postTranslate(w / 2f - z * cx * w, h / 2f - z * cy * h) })
      video.invalidate()
    }

    fun tocar(p: Cameras.Plano, principalVideo: Boolean, comSom: Boolean) {
      som = comSom
      if (p.chave == plano?.chave && principalVideo == principalPedido && (trabalho != null || agendado)) return
      plano = p
      principalPedido = principalVideo
      tentativas = 0
      conectar()
    }

    fun conectar() {
      principal.removeCallbacks(religar)
      agendado = false
      val anterior = trabalho
      parar()
      val p = plano ?: return
      // sem a superfície ainda: conecta quando ela ficar pronta (onSurfaceTextureAvailable)
      val sup = superficie ?: return
      mudar("conectando")
      desde = System.currentTimeMillis()
      val g = ++geracao
      val audio = Som()
      val dec = Decodificador(sup, { w, h ->
        principal.post {
          if (g == geracao) {
            proporcao = w.toFloat() / h
            encaixar()
            chamarTela("proporcaoCamera", "${Web.js(id)}, $proporcao")
          }
        }
      }, {})
      val destino = object : Destino {
        override fun video(mime: String, quadro: ByteArray, chave: Boolean) = dec.entregar(mime, quadro, chave)
        override fun pcm(amostras: ShortArray, n: Int, taxa: Int, canais: Int) { if (som) audio.pcm(amostras, n, taxa, canais) }
        override fun aac(quadro: ByteArray, taxa: Int, canais: Int, config: ByteArray) { if (som) audio.aac(quadro, taxa, canais, config) }
        override val comSom get() = som
      }
      val f: Fonte = when (p) {
        // o som só é pedido à câmera na tela cheia (no mosaico, o celular não gasta rede com ele)
        is Cameras.Plano.Rtsp -> FonteRtsp(p.url, destino, principalPedido)
        is Cameras.Plano.Dvrip -> FonteDvrip(p.ip, p.porta, p.usuario, p.senha, p.canal, p.principal, destino)
      }
      fonte = f
      trabalho = thread(name = "camera") {
        // a conexão anterior solta a superfície antes desta usar (duas no mesmo lugar o Android recusa)
        anterior?.join(3000)
        try { f.rodar() } catch (_: Exception) {} finally {
          f.parar()
          dec.soltar()
          audio.soltar()
        }
        principal.post { if (g == geracao) { trabalho = null; fonte = null; falhou() } }
      }
    }

    private fun parar() {
      geracao++
      fonte?.parar()
      fonte = null
      trabalho = null
    }

    fun mudar(novo: String) {
      if (estado == novo) return
      estado = novo
      avisar(id, novo)
    }

    /** caiu: tenta de novo em 2, 4, 8... até 30 s, para sempre, como no computador */
    fun falhou() {
      parar()
      mudar("semSinal")
      principal.removeCallbacks(religar)
      val espera = minOf(30_000L, 2_000L shl minOf(tentativas, 4))
      tentativas++
      agendado = true
      principal.postDelayed(religar, espera)
    }

    fun soltar() {
      principal.removeCallbacks(religar)
      agendado = false
      val t = trabalho
      parar()
      t?.join(1000)
      palco.removeView(caixa)
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
      superficie = Surface(st)
      if (plano != null) conectar()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
      val t = trabalho
      parar()
      t?.join(1000)
      superficie?.release()
      superficie = null
      return true
    }

    /** cada quadro que chega à tela: a câmera está ao vivo */
    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {
      ultimoQuadro = System.currentTimeMillis()
      if (estado != "vivo") { tentativas = 0; mudar("vivo") }
    }
  }

  private val quadros = mutableMapOf<String, Quadro>()
  private var ultimoLayout = "[]"
  private var visivel = false
  private var exportando: String? = null
  private var textoImportado: String? = null

  // um quadro que segue "conectando" por mais de 20 s, ou ao vivo sem imagem nova há 12 s, é reconectado (a câmera
  // parou de mandar vídeo sem fechar a conexão)
  private val vigia = object : Runnable {
    override fun run() {
      val agora = System.currentTimeMillis()
      for (q in quadros.values) {
        if (q.estado == "conectando" && q.desde > 0 && agora - q.desde > 20_000) q.falhou()
        else if (q.estado == "vivo" && agora - q.ultimoQuadro > 12_000) q.falhou()
      }
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
    resolverPendentes()
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
      vistos += id
      val q = quadros.getOrPut(id) { Quadro(id) }
      p.optJSONObject("zoom")?.let { z -> q.zoom = z.optDouble("z", 1.0).toFloat(); q.zx = z.optDouble("x", .5).toFloat(); q.zy = z.optDouble("y", .5).toFloat() }
      q.posicionar(p.optInt("x"), p.optInt("y"), p.optInt("w"), p.optInt("h"))
      val plano = cameras.plano(c, secundario = !p.optBoolean("principal"))
      // sem endereço (câmera ainda não resolvida neste celular): sem sinal, até resolver
      if (plano == null) { q.mudar("semSinal"); continue }
      q.tocar(plano, p.optBoolean("principal"), p.optBoolean("som"))
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

  /**
   * Câmeras sem o endereço resolvido neste celular (vindas do computador, ou Xiongmai salva antes do DVRIP): o app
   * pergunta a cada uma, fora da tela, e o quadro dela reconecta com o endereço novo.
   */
  private fun resolverPendentes() {
    thread {
      for (c in cameras.ler().filter { cameras.precisaResolver(it) }) {
        val r = cameras.resolver(c)
        if (r.optBoolean("ok")) principal.post { quadros.remove(c.optString("id"))?.soltar(); aplicarLayout(ultimoLayout); chamarTela("recarregar", "") }
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
      if (r.has("novas")) resolverPendentes()
    }
  }

  /** a ponte da tela (assistir.html) para o app */
  inner class Ponte {
    @JavascriptInterface fun listar(): String = cameras.listar().toString()
    @JavascriptInterface fun posicionar(json: String) { principal.post { aplicarLayout(json) } }
    @JavascriptInterface fun zoom(id: String, z: Double, x: Double, y: Double) {
      principal.post { quadros[id]?.apply { zoom = z.toFloat(); zx = x.toFloat(); zy = y.toFloat(); aplicarZoom() } }
    }
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
