// O início do app: a abertura (o letreiro 3D do CCTV Express) e a escolha do modo. A câmera do celular só liga depois,
// no modo câmera: o letreiro e a câmera disputando a GPU ao mesmo tempo deixavam a abertura numa tela preta que só
// saía com um toque. O modo escolhido fica guardado e abre direto nas próximas vezes; o botão Início de cada modo volta
// para a escolha.
package builders.stream.cctvexpress.camera

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView

class InicioActivity : Activity() {

  companion object {
    /** vindo do botão Início de um modo: mostra a escolha sem a abertura */
    const val ESCOLHER = "escolher"
  }

  private lateinit var tela: WebView
  private val principal = Handler(Looper.getMainLooper())
  private var seguiu = false
  private val prefs by lazy { getSharedPreferences("inicio", MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    tela = Web.criar(this, Ponte(), "Inicio", "inicio.html", Color.rgb(7, 8, 10))
    setContentView(tela)
    // trava nativa: se a página nem carregar, a abertura não prende o app
    principal.postDelayed({ aberturaTerminou() }, 12_000)
  }

  private fun escolhendo() = intent.getBooleanExtra(ESCOLHER, false)

  private fun aberturaTerminou() {
    if (seguiu) return
    principal.removeCallbacksAndMessages(null)
    val modo = prefs.getString("modo", null)
    if (modo != null && !escolhendo()) abrir(modo)
    else tela.evaluateJavascript("window.mostrarEscolha ? mostrarEscolha() : (window.escolhaPendente = true)", null)
  }

  private fun abrir(modo: String) {
    if (seguiu) return
    seguiu = true
    prefs.edit().putString("modo", modo).apply()
    val destino = if (modo == "assistir") AssistirActivity::class.java else MainActivity::class.java
    startActivity(Intent(this, destino))
    finish()
  }

  inner class Ponte {
    @JavascriptInterface fun pularAbertura(): Boolean = escolhendo()
    @JavascriptInterface fun ultimoModo(): String = prefs.getString("modo", "") ?: ""
    @JavascriptInterface fun aberturaTerminou() { principal.post { this@InicioActivity.aberturaTerminou() } }
    @JavascriptInterface fun escolher(modo: String) { principal.post { abrir(if (modo == "assistir") "assistir" else "camera") } }
  }
}
