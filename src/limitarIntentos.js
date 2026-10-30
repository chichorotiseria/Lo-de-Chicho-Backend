import { ErrorHttp } from './errores.js'

// Frena los intentos de adivinar una contraseña:
// después de 8 fallos desde la misma IP, se bloquea por 15 minutos
const VENTANA_MS = 15 * 60 * 1000
const MAX_FALLOS = 8

const fallos = new Map() // ip -> { cantidad, desde }

function vigente(registro) {
  return registro && Date.now() - registro.desde < VENTANA_MS
}

export function limitarIntentos(req, res, next) {
  const registro = fallos.get(req.ip)

  if (vigente(registro) && registro.cantidad >= MAX_FALLOS) {
    return next(
      new ErrorHttp(429, 'Demasiados intentos. Probá de nuevo en unos minutos.'),
    )
  }
  next()
}

export function registrarFallo(ip) {
  const registro = fallos.get(ip)

  if (vigente(registro)) {
    registro.cantidad += 1
  } else {
    fallos.set(ip, { cantidad: 1, desde: Date.now() })
  }
}

export function limpiarFallos(ip) {
  fallos.delete(ip)
}

// Cada tanto se borran los registros vencidos para no acumular memoria
setInterval(() => {
  for (const [ip, registro] of fallos) {
    if (!vigente(registro)) fallos.delete(ip)
  }
}, VENTANA_MS).unref()