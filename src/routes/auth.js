import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { firmarToken, requerirSesion } from '../auth.js'
import { ErrorHttp } from '../errores.js'
import { limitarIntentos, limpiarFallos, registrarFallo } from '../limitarIntentos.js'

const router = Router()

// Si el usuario no existe se compara igual contra un hash de mentira,
// para que tarde lo mismo y no se pueda averiguar qué usuarios existen
const HASH_FALSO = bcrypt.hashSync('contraseña-de-mentira', 10)

router.post('/login', limitarIntentos, async (req, res) => {
  const usuario = String(req.body?.usuario ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  const [filas] = await pool.query(
    'SELECT id, usuario, password_hash FROM usuarios WHERE usuario = ?',
    [usuario],
  )
  const fila = filas[0]

  const coincide =
    password.length <= 200 &&
    (await bcrypt.compare(password, fila ? fila.password_hash : HASH_FALSO))

  if (!fila || !coincide) {
    registrarFallo(req.ip)
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos')
  }

  limpiarFallos(req.ip)
  res.json({ token: firmarToken(fila), usuario: fila.usuario })
})

// Sirve para comprobar que una sesión guardada siga vigente
router.get('/yo', requerirSesion, async (req, res) => {
  const [filas] = await pool.query('SELECT usuario FROM usuarios WHERE id = ?', [
    req.usuario.id,
  ])

  if (filas.length === 0) {
    throw new ErrorHttp(401, 'El usuario ya no existe')
  }

  res.json({ usuario: filas[0].usuario })
})

export default router