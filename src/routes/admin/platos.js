import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'
import { borrarImagen, validarImagen } from '../../imagenes.js'

const router = Router()

const CARPETA_FOTOS = 'platos'
const PRECIO_MAXIMO = 1000000
const MAX_OPCIONES = 10

const esPrecioValido = (n) => Number.isInteger(n) && n >= 1 && n <= PRECIO_MAXIMO

// Revisa los datos del formulario y los devuelve limpios
function validar(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') {
    throw new ErrorHttp(400, 'Datos inválidos')
  }

  const categoriaId = Number(cuerpo.categoria_id)
  if (!Number.isInteger(categoriaId) || categoriaId < 1) {
    throw new ErrorHttp(400, 'Elegí una categoría')
  }

  const nombre = String(cuerpo.nombre ?? '').trim()
  if (nombre.length < 1 || nombre.length > 120) {
    throw new ErrorHttp(400, 'El nombre es obligatorio y puede tener hasta 120 letras')
  }

  const descripcion = String(cuerpo.descripcion ?? '').trim()
  if (descripcion.length > 500) {
    throw new ErrorHttp(400, 'La descripción puede tener hasta 500 letras')
  }

  if (typeof cuerpo.disponible !== 'boolean') {
    throw new ErrorHttp(400, 'disponible debe ser true o false')
  }

  const entrada = Array.isArray(cuerpo.variantes) ? cuerpo.variantes : []
  if (entrada.length > MAX_OPCIONES) {
    throw new ErrorHttp(400, `Un plato puede tener hasta ${MAX_OPCIONES} opciones`)
  }

  const variantes = entrada.map((variante) => {
    const nombreOpcion = String(variante?.nombre ?? '').trim()
    if (nombreOpcion.length < 1 || nombreOpcion.length > 80) {
      throw new ErrorHttp(400, 'Cada opción necesita un nombre (hasta 80 letras)')
    }

    if (!esPrecioValido(variante?.precio)) {
      throw new ErrorHttp(400,`El precio de "${nombreOpcion}" debe ser un número entero entre 1 y 1.000.000`)
    }

    const id = variante?.id == null ? null : Number(variante.id)
    if (id !== null && (!Number.isInteger(id) || id < 1)) {
      throw new ErrorHttp(400, 'Opción inválida')
    }

    return { id, nombre: nombreOpcion, precio: variante.precio }
  })

  const nombresUsados = new Set()
  const idsUsados = new Set()
  for (const variante of variantes) {
    const clave = variante.nombre.toLowerCase()
    if (nombresUsados.has(clave)) {
      throw new ErrorHttp(400, `La opción "${variante.nombre}" está repetida`)
    }
    nombresUsados.add(clave)

    if (variante.id !== null) {
      if (idsUsados.has(variante.id)) {
        throw new ErrorHttp(400, 'Opción repetida')
      }
      idsUsados.add(variante.id)
    }
  }

  // Si tiene opciones, el precio está en cada una. Si no, es obligatorio.
  let precio = null
  if (variantes.length === 0) {
    if (!esPrecioValido(cuerpo.precio)) {
      throw new ErrorHttp(400,'El precio debe ser un número entero entre 1 y 1.000.000')
    }
    precio = cuerpo.precio
  }

  const imagen = validarImagen(cuerpo.imagen_url, cuerpo.imagen_id, CARPETA_FOTOS)

  return {
    categoriaId,
    nombre,
    descripcion: descripcion || null,
    disponible: cuerpo.disponible,
    precio,
    variantes,
    imagenUrl: imagen.url,
    imagenId: imagen.id,
  }
}

function leerId(req) {
  const id = Number(req.params.id)

  if (!Number.isInteger(id) || id < 1) {
    throw new ErrorHttp(400, 'Identificador inválido')
  }

  return id
}

async function exigirCategoria(id) {
  const [filas] = await pool.query('SELECT id FROM categorias WHERE id = ?', [id])

  if (filas.length === 0) {
    throw new ErrorHttp(400, 'La categoría no existe')
  }
}

// Todos los platos con sus opciones, agrupables por categoría en el panel
router.get('/', async (req, res) => {
  const [platos] = await pool.query(
    `SELECT id, categoria_id, nombre, descripcion, precio,
            imagen_url, imagen_id, disponible, orden
     FROM platos
     ORDER BY categoria_id, orden, id`,
  )
  const [variantes] = await pool.query('SELECT id, plato_id, nombre, precio FROM variantes ORDER BY orden, id')

  const variantesPorPlato = new Map()
  for (const variante of variantes) {
    const lista = variantesPorPlato.get(variante.plato_id) ?? []
    lista.push({ id: variante.id, nombre: variante.nombre, precio: variante.precio })
    variantesPorPlato.set(variante.plato_id, lista)
  }

  res.json({
    platos: platos.map((plato) => ({
      ...plato,
      disponible: Boolean(plato.disponible),
      variantes: variantesPorPlato.get(plato.id) ?? [],
    })),
  })
})

router.post('/', async (req, res) => {
  const datos = validar(req.body)
  await exigirCategoria(datos.categoriaId)

  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    // El plato nuevo queda al final de su categoría
    const [[{ siguiente }]] = await conexion.query(
      'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM platos WHERE categoria_id = ?',
      [datos.categoriaId],
    )

    const [resultado] = await conexion.query(
      `INSERT INTO platos
         (categoria_id, nombre, descripcion, precio, imagen_url, imagen_id, disponible, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.categoriaId,
        datos.nombre,
        datos.descripcion,
        datos.precio,
        datos.imagenUrl,
        datos.imagenId,
        datos.disponible ? 1 : 0,
        siguiente,
      ],
    )
    const platoId = resultado.insertId

    for (const [i, variante] of datos.variantes.entries()) {
      await conexion.query(
        'INSERT INTO variantes (plato_id, nombre, precio, orden) VALUES (?, ?, ?, ?)',
        [platoId, variante.nombre, variante.precio, i + 1],
      )
    }

    await conexion.commit()
    res.status(201).json({ id: platoId })
  } catch (error) {
    await conexion.rollback()
    throw error
  } finally {
    conexion.release()
  }
})

router.put('/:id', async (req, res) => {
  const id = leerId(req)
  const datos = validar(req.body)

  const [actuales] = await pool.query(
    'SELECT id, categoria_id, imagen_id FROM platos WHERE id = ?',
    [id],
  )
  if (actuales.length === 0) {
    throw new ErrorHttp(404, 'El plato no existe')
  }
  const actual = actuales[0]

  await exigirCategoria(datos.categoriaId)

  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    // Si cambia de categoría, queda al final de la nueva
    let ordenNuevo = null
    if (datos.categoriaId !== actual.categoria_id) {
      const [[{ siguiente }]] = await conexion.query(
        'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM platos WHERE categoria_id = ?',
        [datos.categoriaId],
      )
      ordenNuevo = siguiente
    }

    await conexion.query(
      `UPDATE platos
       SET categoria_id = ?, nombre = ?, descripcion = ?, precio = ?,
           imagen_url = ?, imagen_id = ?, disponible = ?, orden = COALESCE(?, orden)
       WHERE id = ?`,
      [
        datos.categoriaId,
        datos.nombre,
        datos.descripcion,
        datos.precio,
        datos.imagenUrl,
        datos.imagenId,
        datos.disponible ? 1 : 0,
        ordenNuevo,
        id,
      ],
    )

    // Las opciones existentes se actualizan (conservan su id), las nuevas se
    // crean y las que ya no vienen se borran
    const [existentes] = await conexion.query(
      'SELECT id FROM variantes WHERE plato_id = ?',
      [id],
    )
    const idsExistentes = existentes.map((fila) => fila.id)

    for (const variante of datos.variantes) {
      if (variante.id !== null && !idsExistentes.includes(variante.id)) {
        throw new ErrorHttp(400, 'Opción inválida')
      }
    }

    const idsQueQuedan = datos.variantes
      .filter((variante) => variante.id !== null)
      .map((variante) => variante.id)
    const aBorrar = idsExistentes.filter((varianteId) => !idsQueQuedan.includes(varianteId))

    if (aBorrar.length > 0) {
      await conexion.query('DELETE FROM variantes WHERE id IN (?)', [aBorrar])
    }

    for (const [i, variante] of datos.variantes.entries()) {
      if (variante.id !== null) {
        await conexion.query(
          'UPDATE variantes SET nombre = ?, precio = ?, orden = ? WHERE id = ? AND plato_id = ?',
          [variante.nombre, variante.precio, i + 1, variante.id, id],
        )
      } else {
        await conexion.query(
          'INSERT INTO variantes (plato_id, nombre, precio, orden) VALUES (?, ?, ?, ?)',
          [id, variante.nombre, variante.precio, i + 1],
        )
      }
    }

    await conexion.commit()
  } catch (error) {
    await conexion.rollback()
    throw error
  } finally {
    conexion.release()
  }

  // Si cambió o se quitó la foto, la anterior se borra de Cloudinary
  if (actual.imagen_id && actual.imagen_id !== datos.imagenId) {
    borrarImagen(actual.imagen_id)
  }

  res.json({ ok: true })
})

// Marca un plato como disponible o no disponible (el interruptor del panel)
router.put('/:id/disponible', async (req, res) => {
  const id = leerId(req)

  if (typeof req.body?.disponible !== 'boolean') {
    throw new ErrorHttp(400, 'disponible debe ser true o false')
  }

  const [resultado] = await pool.query(
    'UPDATE platos SET disponible = ? WHERE id = ?',
    [req.body.disponible ? 1 : 0, id],
  )

  if (resultado.affectedRows === 0) {
    throw new ErrorHttp(404, 'El plato no existe')
  }

  res.json({ ok: true })
})

// Sube o baja un plato un lugar dentro de su categoría
router.put('/:id/mover', async (req, res) => {
  const id = leerId(req)
  const direccion = req.body?.direccion

  if (direccion !== 'arriba' && direccion !== 'abajo') {
    throw new ErrorHttp(400, 'La dirección debe ser "arriba" o "abajo"')
  }

  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    const [platos] = await conexion.query(
      'SELECT categoria_id FROM platos WHERE id = ?',
      [id],
    )
    if (platos.length === 0) {
      throw new ErrorHttp(404, 'El plato no existe')
    }

    const [filas] = await conexion.query(
      'SELECT id FROM platos WHERE categoria_id = ? ORDER BY orden, id FOR UPDATE',
      [platos[0].categoria_id],
    )
    const ids = filas.map((fila) => fila.id)

    const posicion = ids.indexOf(id)
    const destino = direccion === 'arriba' ? posicion - 1 : posicion + 1

    if (destino >= 0 && destino < ids.length) {
      const temporal = ids[posicion]
      ids[posicion] = ids[destino]
      ids[destino] = temporal
    }

    // Se renumera toda la categoría, así nunca quedan órdenes repetidos
    for (let i = 0; i < ids.length; i++) {
      await conexion.query('UPDATE platos SET orden = ? WHERE id = ?', [i + 1, ids[i]])
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

  const [filas] = await pool.query('SELECT imagen_id FROM platos WHERE id = ?', [id])
  if (filas.length === 0) {
    throw new ErrorHttp(404, 'El plato no existe')
  }

  // Sus opciones se borran solas. Los pedidos ya hechos conservan el nombre y
  // el precio, porque se copiaron dentro del pedido.
  await pool.query('DELETE FROM platos WHERE id = ?', [id])
  borrarImagen(filas[0].imagen_id)

  res.json({ ok: true })
})

export default router