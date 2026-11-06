// O paralelogramo da identidade Stream.Builders / ebooks.express (a peça .sb-btn em skew): o corpo inclinado, com o
// brilho de metal de cima para baixo e o fio da borda. Usado nos botões e nos selos do app, no lugar do retângulo.
package builders.stream.cctvexpress.camera

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Shader
import android.graphics.drawable.Drawable

class Paralelogramo(
  private val corCima: Int,
  private val corBaixo: Int,
  private val corBorda: Int,
  /** a inclinação em fração da altura (a .sb-btn usa 0,3) */
  private val inclinacao: Float = 0.3f,
  private val espessuraBorda: Float = 2f,
) : Drawable() {

  private val corpo = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val borda = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = espessuraBorda; color = corBorda }
  private val caminho = Path()

  override fun draw(canvas: Canvas) {
    val b = bounds
    val sk = b.height() * inclinacao
    val m = espessuraBorda / 2
    caminho.reset()
    caminho.moveTo(b.left + sk, b.top + m)
    caminho.lineTo(b.right - m, b.top + m)
    caminho.lineTo(b.right - sk, b.bottom - m)
    caminho.lineTo(b.left + m, b.bottom - m)
    caminho.close()
    corpo.shader = LinearGradient(0f, b.top.toFloat(), 0f, b.bottom.toFloat(), corCima, corBaixo, Shader.TileMode.CLAMP)
    canvas.drawPath(caminho, corpo)
    canvas.drawPath(caminho, borda)
  }

  override fun setAlpha(alpha: Int) { corpo.alpha = alpha; borda.alpha = alpha }
  override fun setColorFilter(colorFilter: ColorFilter?) { corpo.colorFilter = colorFilter; borda.colorFilter = colorFilter }
  @Deprecated("Deprecated in Java")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
