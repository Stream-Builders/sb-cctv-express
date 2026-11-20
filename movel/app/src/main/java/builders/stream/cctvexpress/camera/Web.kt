// A tela HTML de cada modo do app: os assets são servidos por https local (módulos JS, o letreiro 3D e os textos dos
// 18 idiomas não abrem por file://), sem acesso a arquivos do celular.
package builders.stream.cctvexpress.camera

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

object Web {
  const val ORIGEM = "https://appassets.androidplatform.net/assets/"

  @SuppressLint("SetJavaScriptEnabled")
  fun criar(activity: Activity, ponte: Any, nome: String, pagina: String, fundo: Int = Color.TRANSPARENT): WebView =
    WebView(activity).apply {
      setBackgroundColor(fundo)
      settings.javaScriptEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.mediaPlaybackRequiresUserGesture = true
      addJavascriptInterface(ponte, nome)
      val carregador = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(activity)).build()
      webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
          carregador.shouldInterceptRequest(request.url)
        // nada sai do app pela tela: links externos não abrem dentro dela
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          !request.url.toString().startsWith(ORIGEM)
      }
      loadUrl(ORIGEM + pagina)
    }

  /** Texto JS seguro (aspas, barras e quebras escapadas) para passar dados ao evaluateJavascript. */
  fun js(s: String): String = org.json.JSONObject.quote(s)
}
