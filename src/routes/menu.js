import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Menú completo, con sus categorías, platos y variantes
router.get('/', async (req, res) => {
  const [categorias] = await pool.query(
    'SELECT id, nombre FROM categorias ORDER BY orden, id',
  )
  const [platos] = await pool.query(
    `SELECT id, categoria_id, nombre, descripcion, precio, imagen_url, disponible
     FROM platos ORDER BY orden, id`,
  )
  const [variantes] = await pool.query(
    'SELECT id, plato_id, nombre, precio FROM variantes ORDER BY orden, id',
  )

  // Variantes agrupadas por plato
  const variantesPorPlato = new Map()
  for (const v of variantes) {
    const lista = variantesPorPlato.get(v.plato_id) ?? []
    lista.push({ id: v.id, nombre: v.nombre, precio: v.precio })
    variantesPorPlato.set(v.plato_id, lista)
  }

  // Platos agrupados por categoría
  const platosPorCategoria = new Map()
  for (const p of platos) {
    const variantesDelPlato = variantesPorPlato.get(p.id) ?? []

    // Un plato sin precio y sin variantes no se mostra
    if (p.precio === null && variantesDelPlato.length === 0) continue

    const lista = platosPorCategoria.get(p.categoria_id) ?? []
    lista.push({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: p.precio,
      imagen_url: p.imagen_url,
      disponible: Boolean(p.disponible),
      variantes: variantesDelPlato,
    })
    platosPorCategoria.set(p.categoria_id, lista)
  }

  // Las categorías sin platos no se muestran
  const menu = categorias
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      platos: platosPorCategoria.get(c.id) ?? [],
    }))
    .filter((c) => c.platos.length > 0)

  res.json({ categorias: menu })
})

export default router