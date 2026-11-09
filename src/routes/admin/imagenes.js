import { Router } from 'express'
import { ErrorHttp } from '../../errores.js'
import { borrarImagen, esIdPropio, firmarSubida } from '../../imagenes.js'

const router = Router()

// Datos para que el navegador suba una foto directo a Cloudinary
router.get('/firma', (req, res) => {
  res.json(firmarSubida(String(req.query.carpeta ?? '')))
})

// Descarta una foto que se subió pero no se llegó a guardar
router.delete('/', (req, res) => {
  const id = req.body?.id

  if (!esIdPropio(id)) {
    throw new ErrorHttp(400, 'Foto inválida')
  }

  borrarImagen(id) // sin esperar: no frena la respuesta
  res.json({ ok: true })
})

export default router