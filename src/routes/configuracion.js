import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Público: estado del local y costo de envío
router.get('/', async (req, res) => {
  const [filas] = await pool.query(
    'SELECT local_abierto, costo_envio FROM configuracion WHERE id = 1',
  )
  const fila = filas[0]

  res.json({
    local_abierto: Boolean(fila.local_abierto),
    costo_envio: fila.costo_envio,
  })
})

export default router