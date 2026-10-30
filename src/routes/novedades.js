import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Novedades, la más reciente primero
router.get('/', async (req, res) => {
  const [novedades] = await pool.query(
    `SELECT id, tipo, titulo, descripcion, imagen_url, creada_en
     FROM novedades
     ORDER BY creada_en DESC, id DESC`,
  )

  res.json({ novedades })
})

export default router