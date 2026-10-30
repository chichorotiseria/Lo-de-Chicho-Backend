import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'

const router = Router()

async function leerConfiguracion() {
  const [filas] = await pool.query(
    'SELECT local_abierto, costo_envio FROM configuracion WHERE id = 1',
  )

  return {
    local_abierto: Boolean(filas[0].local_abierto),
    costo_envio: filas[0].costo_envio,
  }
}

router.get('/', async (req, res) => {
  res.json(await leerConfiguracion())
})

// Cambia el estado del local y/o el costo de envío (se puede mandar uno solo)
router.put('/', async (req, res) => {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {}
  const cambios = []
  const valores = []

  if ('local_abierto' in cuerpo) {
    if (typeof cuerpo.local_abierto !== 'boolean') {
      throw new ErrorHttp(400, 'local_abierto debe ser true o false')
    }
    cambios.push('local_abierto = ?')
    valores.push(cuerpo.local_abierto ? 1 : 0)
  }

  if ('costo_envio' in cuerpo) {
    const costo = cuerpo.costo_envio
    if (!Number.isInteger(costo) || costo < 0 || costo > 1000000) {
      throw new ErrorHttp(
        400,
        'El costo de envío debe ser un número entero entre 0 y 1.000.000',
      )
    }
    cambios.push('costo_envio = ?')
    valores.push(costo)
  }

  if (cambios.length === 0) {
    throw new ErrorHttp(400, 'No hay nada para cambiar')
  }

  await pool.query(
    `UPDATE configuracion SET ${cambios.join(', ')} WHERE id = 1`,
    valores,
  )

  res.json(await leerConfiguracion())
})

export default router