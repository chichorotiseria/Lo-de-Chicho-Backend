import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'

const router = Router()

function leerNombre(cuerpo) {
  const nombre = String(cuerpo?.nombre ?? '').trim()

  if (nombre.length < 1 || nombre.length > 80) {
    throw new ErrorHttp(400, 'El nombre es obligatorio y puede tener hasta 80 letras')
  }

  return nombre
}

function leerId(req) {
  const id = Number(req.params.id)

  if (!Number.isInteger(id) || id < 1) {
    throw new ErrorHttp(400, 'Identificador inválido')
  }

  return id
}

async function exigirQueExista(id) {
  const [filas] = await pool.query('SELECT id FROM categorias WHERE id = ?', [id])

  if (filas.length === 0) {
    throw new ErrorHttp(404, 'La categoría no existe')
  }
}

// No puede haber dos categorías con el mismo nombre
async function exigirNombreLibre(nombre, idActual = 0) {
  const [filas] = await pool.query(
    'SELECT id FROM categorias WHERE nombre = ? AND id <> ?',
    [nombre, idActual],
  )

  if (filas.length > 0) {
    throw new ErrorHttp(409, 'Ya existe una categoría con ese nombre')
  }
}

// Las categorías en el orden en que se ven en el menú, con su cantidad de platos
router.get('/', async (req, res) => {
  const [categorias] = await pool.query(
    `SELECT c.id, c.nombre, COUNT(p.id) AS cantidad_platos
     FROM categorias c
     LEFT JOIN platos p ON p.categoria_id = c.id
     GROUP BY c.id, c.nombre, c.orden
     ORDER BY c.orden, c.id`,
  )

  res.json({ categorias })
})

router.post('/', async (req, res) => {
  const nombre = leerNombre(req.body)
  await exigirNombreLibre(nombre)

  // La nueva categoría queda al final
  const [[{ siguiente }]] = await pool.query(
    'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM categorias',
  )

  const [resultado] = await pool.query(
    'INSERT INTO categorias (nombre, orden) VALUES (?, ?)',
    [nombre, siguiente],
  )

  res.status(201).json({ id: resultado.insertId })
})

router.put('/:id', async (req, res) => {
  const id = leerId(req)
  const nombre = leerNombre(req.body)

  await exigirQueExista(id)
  await exigirNombreLibre(nombre, id)

  await pool.query('UPDATE categorias SET nombre = ? WHERE id = ?', [nombre, id])

  res.json({ ok: true })
})

// Sube o baja una categoría un lugar en el menú
router.put('/:id/mover', async (req, res) => {
  const id = leerId(req)
  const direccion = req.body?.direccion

  if (direccion !== 'arriba' && direccion !== 'abajo') {
    throw new ErrorHttp(400, 'La dirección debe ser "arriba" o "abajo"')
  }

  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    const [filas] = await conexion.query(
      'SELECT id FROM categorias ORDER BY orden, id FOR UPDATE',
    )
    const ids = filas.map((fila) => fila.id)

    const posicion = ids.indexOf(id)
    if (posicion === -1) {
      throw new ErrorHttp(404, 'La categoría no existe')
    }

    const destino = direccion === 'arriba' ? posicion - 1 : posicion + 1

    if (destino >= 0 && destino < ids.length) {
      const temporal = ids[posicion]
      ids[posicion] = ids[destino]
      ids[destino] = temporal
    }

    // Se renumera todo, así nunca quedan dos categorías con el mismo orden
    for (let i = 0; i < ids.length; i++) {
      await conexion.query('UPDATE categorias SET orden = ? WHERE id = ?', [
        i + 1,
        ids[i],
      ])
    }

    await conexion.commit()
    res.json({ ok: true })
  } catch (error) {
    await conexion.rollback()
    throw error
  } finally {
    conexion.release()
  }
})

router.delete('/:id', async (req, res) => {
  const id = leerId(req)
  await exigirQueExista(id)

  const [[{ cantidad }]] = await pool.query(
    'SELECT COUNT(*) AS cantidad FROM platos WHERE categoria_id = ?',
    [id],
  )

  if (cantidad > 0) {
    throw new ErrorHttp(
      409,
      'Esta categoría todavía tiene platos. Primero pasalos a otra categoría o borralos.',
    )
  }

  await pool.query('DELETE FROM categorias WHERE id = ?', [id])

  res.json({ ok: true })
})

export default router