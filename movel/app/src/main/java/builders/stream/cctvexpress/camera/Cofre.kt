// As senhas das câmeras ficam cifradas no celular (AES-GCM com a chave guardada no Android Keystore, que não sai do
// aparelho). O arquivo de preferências guarda só o texto cifrado.
package builders.stream.cctvexpress.camera

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object Cofre {
  private const val ALIAS = "cctv-express-cameras"

  private fun chave(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gerador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gerador.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gerador.generateKey()
  }

  fun fechar(texto: String): String {
    if (texto.isEmpty()) return ""
    val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, chave()) }
    val cifrado = c.doFinal(texto.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(c.iv + cifrado, Base64.NO_WRAP)
  }

  fun abrir(guardado: String): String {
    if (guardado.isEmpty()) return ""
    return try {
      val bytes = Base64.decode(guardado, Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, chave(), GCMParameterSpec(128, bytes, 0, 12))
      String(c.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
    } catch (_: Exception) { "" } // chave apagada (app reinstalado): a pessoa digita a senha de novo
  }
}
