import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'
import { borrarImagen, borrarImagenes, validarImagen } from '../../imagenes.js'

const router = Router()

const TIPOS = ['oferta', 'combo', 'plato_del_dia']
const CARPETA_FOTOS = 'novedades'

// Revisa los datos del formulario y los devuelve limpios
function validar(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') {
    throw new ErrorHttp(400, 'Datos inválidos')
  }

  if (!TIPOS.includes(cuerpo.tipo)) {
    throw new ErrorHttp(400, 'El tipo de novedad no es válido')
  }

  const titulo = String(cuerpo.titulo ?? '').trim()
  if (titulo.length < 1 || titulo.length > 120) {
    throw new ErrorHttp(400, 'El título es obligatorio y puede tener hasta 120 letras')
  }

  const descripcion = String(cuerpo.descripcion ?? '').trim()
  if (descripcion.length > 1000) {
    throw new ErrorHttp(400, 'La descripción puede tener hasta 1000 letras')
  }

  const imagen = validarImagen(cuerpo.imagen_url, cuerpo.imagen_id, CARPETA_FOTOS)

  return {
    tipo: cuerpo.tipo,
    titulo,
    descripcion: descripcion || null,
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

async function buscar(id) {
  const [filas] = await pool.query(
    'SELECT id, imagen_id FROM novedades WHERE id = ?',
    [id],
  )
  if (filas.length === 0) {
    throw new ErrorHttp(404, 'La novedad no existe')
  }
  return filas[0]
}

// Todas las novedades, la más reciente primero
router.get('/', async (req, res) => {
  const [novedades] = await pool.query(
    `SELECT id, tipo, titulo, descripcion, imagen_url, imagen_id, creada_en
     FROM novedades
     ORDER BY creada_en DESC, id DESC`,
  )
  res.json({ novedades })
})

router.post('/', async (req, res) => {
  const datos = validar(req.body)

  const [resultado] = await pool.query(
    `INSERT INTO novedades (tipo, titulo, descripcion, imagen_url, imagen_id)
     VALUES (?, ?, ?, ?, ?)`,
    [datos.tipo, datos.titulo, datos.descripcion, datos.imagenUrl, datos.imagenId],
  )

  res.status(201).json({ id: resultado.insertId })
})

router.put('/:id', async (req, res) => {
  const id = leerId(req)
  const datos = validar(req.body)
  const actual = await buscar(id)

  await pool.query(
    `UPDATE novedades
     SET tipo = ?, titulo = ?, descripcion = ?, imagen_url = ?, imagen_id = ?
     WHERE id = ?`,
    [datos.tipo, datos.titulo, datos.descripcion, datos.imagenUrl, datos.imagenId, id],
  )

  // Si cambió o se quitó la foto, la anterior se borra de Cloudinary
  if (actual.imagen_id && actual.imagen_id !== datos.imagenId) {
    borrarImagen(actual.imagen_id)
  }

  res.json({ ok: true })
})

// Borra todas las novedades. Hay que pedirlo de forma explícita (?todas=si)
router.delete('/', async (req, res) => {
  if (req.query.todas !== 'si') {
    throw new ErrorHttp(400, 'Para borrar todas hay que confirmarlo (todas=si)')
  }

  const [filas] = await pool.query('SELECT imagen_id FROM novedades')
  await pool.query('DELETE FROM novedades')

  borrarImagenes(filas.map((fila) => fila.imagen_id))

  res.json({ borradas: filas.length })
})

router.delete('/:id', async (req, res) => {
  const id = leerId(req)
  const actual = await buscar(id)

  await pool.query('DELETE FROM novedades WHERE id = ?', [id])
  borrarImagen(actual.imagen_id)

  res.json({ ok: true })
})

export default router