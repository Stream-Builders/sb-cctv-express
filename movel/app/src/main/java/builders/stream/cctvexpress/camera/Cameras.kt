// As câmeras que o celular assiste, guardadas nas preferências do app no mesmo formato do CCTV Express do computador
// (nome, tipo, ip, porta, canal, usuário, endereço RTSP). A senha vai cifrada pelo Cofre (Android Keystore).
// Ao salvar, o app descobre o endereço do vídeo (ONVIF ou sonda RTSP) e guarda o principal e o secundário (o leve, para
// o mosaico), para assistir sem perguntar de novo à câmera.
package builders.stream.cctvexpress.camera

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

class Cameras(contexto: Context) {
  private val prefs = contexto.getSharedPreferences("assistir", Context.MODE_PRIVATE)

  fun ler(): MutableList<JSONObject> = try {
    val a = JSONArray(prefs.getString("cameras", "[]"))
    MutableList(a.length()) { a.getJSONObject(it) }
  } catch (_: Exception) { mutableListOf() }

  private fun gravar(lista: List<JSONObject>) {
    prefs.edit().putString("cameras", JSONArray(lista).toString()).apply()
  }

  /** Lista para a tela: sem a senha. */
  fun listar(): JSONArray = JSONArray(ler().map { c ->
    JSONObject(c.toString()).apply { remove("senhaCifrada"); put("temSenha", c.optString("senhaCifrada").isNotEmpty()) }
  })

  fun senhaDe(c: JSONObject): String = Cofre.abrir(c.optString("senhaCifrada"))

  fun remover(id: String) = gravar(ler().filter { it.optString("id") != id })

  /** rstp:// (letras trocadas) e rtsp sem barras viram rtsp:// */
  private fun limparUrl(u: String) = u.trim().replace(Regex("^(rstp|rtps|rtsp):/*", RegexOption.IGNORE_CASE), "rtsp://")

  /**
   * Salva (novo ou edição) e resolve o endereço do vídeo. Roda fora da tela (fala com a câmera). Devolve
   * {ok, id} ou {erro: "senha" | "caminho" | "onvif" | "ip"}.
   */
  fun salvar(dados: JSONObject): JSONObject {
    val lista = ler()
    val id = dados.optString("id")
    val i = if (id.isNotEmpty()) lista.indexOfFirst { it.optString("id") == id } else -1
    val atual = if (i >= 0) lista[i] else JSONObject().put("id", UUID.randomUUID().toString())
    val ip = dados.optString("ip").trim()
    val tipo = dados.optString("tipo").takeIf { it in listOf("xiongmai", "onvif", "rtsp") } ?: "rtsp"
    var url = limparUrl(dados.optString("url"))
    val ipEfetivo = ip.ifEmpty { Regex("^rtsp://(?:[^@/]*@)?([^:/?]+)").find(url)?.groupValues?.get(1) ?: "" }
    if (ipEfetivo.isEmpty()) return JSONObject().put("erro", "ip")
    // senha em branco na edição = manter a que já existe
    val senha = dados.optString("senha").ifEmpty { senhaDe(atual) }
    val usuario = dados.optString("usuario").trim()
    val porta = dados.optString("porta").toIntOrNull()
    val canal = dados.optString("canal").toIntOrNull()?.coerceIn(1, 64) ?: 1
    var sub: String? = null
    try {
      when {
        tipo == "onvif" -> {
          val e = Onvif(ipEfetivo, porta ?: 80, usuario.ifEmpty { "admin" }, senha, canal).enderecos()
          url = e.principal; sub = e.secundario
        }
        // Xiongmai/iCSee: o protocolo próprio (34567) não toca no Android; o mesmo aparelho entrega o vídeo pelo RTSP
        tipo == "xiongmai" || url.isEmpty() -> {
          val r = SondaRtsp.descobrir(ipEfetivo, if (tipo == "xiongmai") 554 else porta, usuario.ifEmpty { "admin" }, senha, canal)
          url = r.url ?: return JSONObject().put("erro", r.erro)
        }
      }
    } catch (e: Onvif.Falha) {
      return JSONObject().put("erro", if (e.senhaErrada) "senha" else "onvif")
    } catch (_: Exception) {
      return JSONObject().put("erro", "onvif")
    }
    val camera = atual
      .put("nome", dados.optString("nome").trim().ifEmpty { ipEfetivo })
      .put("tipo", tipo).put("ip", ipEfetivo).put("porta", porta ?: JSONObject.NULL).put("canal", canal)
      .put("usuario", usuario)
      // o endereço digitado (RTSP) fica como a pessoa escreveu; o resolvido é o que o player usa
      .put("url", if (tipo == "rtsp") limparUrl(dados.optString("url")).ifEmpty { url } else "")
      .put("video", url).put("videoSub", sub ?: secundarioDe(url) ?: JSONObject.NULL)
    if (dados.optString("senha").isNotEmpty()) camera.put("senhaCifrada", Cofre.fechar(senha))
    if (i >= 0) lista[i] = camera else lista.add(camera)
    gravar(lista)
    return JSONObject().put("ok", true).put("id", camera.getString("id"))
  }

  /** O vídeo secundário (leve) pelo padrão de cada marca; sem padrão conhecido, o mosaico usa o principal. */
  private fun secundarioDe(url: String): String? {
    val trocas = listOf(
      Regex("stream=0\\.sdp") to "stream=1.sdp", // Xiongmai
      Regex("subtype=0") to "subtype=1", // Dahua, Intelbras
      Regex("(/Streaming/Channels/\\d+)01\\b", RegexOption.IGNORE_CASE) to "$102", // Hikvision
      Regex("_main\\b") to "_sub", // Reolink
      Regex("/stream1\\b") to "/stream2", // Tapo
      Regex("/s0/live") to "/s1/live", // Uniview
    )
    for ((r, s) in trocas) if (r.containsMatchIn(url)) return url.replace(r, s)
    return null
  }

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  /** O endereço com usuário e senha, só na hora de tocar (o salvo não guarda a senha). */
  fun enderecoParaTocar(c: JSONObject, secundario: Boolean): String? {
    val base = (if (secundario) c.optString("videoSub").takeIf { it.isNotEmpty() && it != "null" } else null)
      ?: c.optString("video").ifEmpty { c.optString("url") }
    if (base.isEmpty()) return null
    val usuario = c.optString("usuario").ifEmpty { "admin" }
    val senha = senhaDe(c)
    // caminho Xiongmai (user=...&password=...): a senha vai também no caminho, onde a câmera a lê
    val comSenha = base.replace(Regex("([?&/]password=)(?=&|$)", RegexOption.IGNORE_CASE), "$1${Regex.escapeReplacement(enc(senha))}")
    if (senha.isEmpty() && c.optString("usuario").isEmpty()) return comSenha
    return comSenha.replace(Regex("^rtsp://(?:[^@/]*@)?"), "rtsp://${Regex.escapeReplacement(enc(usuario))}:${Regex.escapeReplacement(enc(senha))}@")
  }

  // ---- arquivo de configuração rápida (.cctvx), o mesmo do CCTV Express do computador ----

  /** As câmeras no formato de troca (com a senha aberta só se o arquivo for cifrado). */
  fun paraExportar(comSenha: Boolean): JSONArray = JSONArray(ler().map { c ->
    JSONObject().put("nome", c.optString("nome")).put("tipo", c.optString("tipo")).put("ip", c.optString("ip"))
      .put("porta", c.opt("porta") ?: JSONObject.NULL).put("canal", c.optInt("canal", 1))
      .put("usuario", c.optString("usuario")).put("url", c.optString("url"))
      .put("video", c.optString("video")).put("videoSub", c.opt("videoSub") ?: JSONObject.NULL)
      .apply { if (comSenha) put("senha", senhaDe(c)) }
  })

  /** Acrescenta as câmeras do arquivo; a que já existe (mesmo tipo, IP, canal e endereço) não é duplicada. */
  fun importar(lista: JSONArray): Int {
    val atuais = ler()
    val chave = { c: JSONObject -> "${c.optString("tipo")}|${c.optString("ip")}|${c.optInt("canal", 1)}|${c.optString("url")}" }
    val existentes = atuais.map(chave).toMutableSet()
    var novas = 0
    for (k in 0 until lista.length()) {
      val e = lista.optJSONObject(k) ?: continue
      val tipo = e.optString("tipo").takeIf { it in listOf("xiongmai", "onvif", "rtsp") } ?: continue
      val c = JSONObject().put("id", UUID.randomUUID().toString()).put("nome", e.optString("nome").ifEmpty { e.optString("ip") })
        .put("tipo", tipo).put("ip", e.optString("ip")).put("porta", e.opt("porta") ?: JSONObject.NULL)
        .put("canal", e.optInt("canal", 1)).put("usuario", e.optString("usuario")).put("url", limparUrl(e.optString("url")))
        .put("video", e.optString("video")).put("videoSub", e.opt("videoSub") ?: JSONObject.NULL)
      if (!existentes.add(chave(c))) continue
      e.optString("senha").takeIf { it.isNotEmpty() }?.let { c.put("senhaCifrada", Cofre.fechar(it)) }
      atuais.add(c)
      novas++
    }
    gravar(atuais)
    return novas
  }

  /** Câmera importada do computador sem o endereço resolvido (Xiongmai/ONVIF): o app resolve na primeira vez. */
  fun precisaResolver(c: JSONObject) = c.optString("video").isEmpty() && c.optString("url").isEmpty()

  fun resolver(c: JSONObject): JSONObject {
    val d = JSONObject(c.toString()).put("senha", "")
    return salvar(d)
  }
}
