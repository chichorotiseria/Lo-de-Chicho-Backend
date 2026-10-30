import 'dotenv/config'
import jwt from 'jsonwebtoken'
import { ErrorHttp } from './errores.js'

if (!process.env.JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en el archivo .env')
}

// Cuánto dura una sesión iniciada
const DURACION_SESION = '7d'

export function firmarToken(usuario) {
  return jwt.sign(
    { sub: String(usuario.id), usuario: usuario.usuario },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: DURACION_SESION },
  )
}

// Middleware: deja pasar solo los pedidos que traen una sesión válida
export function requerirSesion(req, res, next) {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ')

  if (tipo !== 'Bearer' || !token) {
    return next(new ErrorHttp(401, 'Necesitás iniciar sesión'))
  }

  try {
    const datos = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    })
    req.usuario = { id: Number(datos.sub), usuario: datos.usuario }
    next()
  } catch {
    next(new ErrorHttp(401, 'La sesión venció, volvé a iniciar sesión'))
  }
}