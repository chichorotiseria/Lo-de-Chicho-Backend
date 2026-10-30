// Crea un usuario del panel, o le cambia la contraseña si ya existe.
// Uso:  node scripts/crear-usuario.js <usuario> "<contraseña>"
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool } from '../src/db.js'

const [usuarioIngresado, password] = process.argv.slice(2)

if (!usuarioIngresado || !password) {
  console.error('Uso: node scripts/crear-usuario.js <usuario> "<contraseña>"')
  process.exit(1)
}

if (password.length < 8) {
  console.error('La contraseña tiene que tener al menos 8 caracteres.')
  process.exit(1)
}

const usuario = usuarioIngresado.trim().toLowerCase()
const hash = await bcrypt.hash(password, 10)

try {
  await pool.query(
    `INSERT INTO usuarios (usuario, password_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [usuario, hash],
  )
  console.log(`Listo: usuario "${usuario}" creado o con la contraseña actualizada.`)
} catch (error) {
  console.error('No se pudo guardar el usuario:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}