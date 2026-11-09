import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'
import { calcularLineas, validarProductos } from '../../lineasDePedido.js'

const router = Router()

// Cuántos pedidos como máximo se traen a la pantalla (los más recientes)
const MAXIMO_LISTA = 200

const TIPOS_ENTREGA = ['retiro', 'delivery']
const METODOS_PAGO = ['efectivo', 'transferencia']

// Sin letras confusas como O, I, 0 o 1
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Los pedidos cargados a mano llevan "E-" adelante (por "externo"); los de la
// web nunca tienen guion, así que no se pueden confundir
function generarCodigo() {
  const bytes = randomBytes(5)
  return 'E-' + Array.from(bytes, (byte) => ALFABETO[byte % ALFABETO.length]).join('')
}

function leerId(req) {
  const id = Number(req.params.id)

  if (!Number.isInteger(id) || id < 1) {
    throw new ErrorHttp(400, 'Identificador inválido')
  }

  return id
}

async function exigirQueExista(id) {
  const [filas] = await pool.query('SELECT id FROM pedidos WHERE id = ?', [id])

  if (filas.length === 0) {
    throw new ErrorHttp(404, 'El pedido no existe')
  }
}

// La fecha del pedido: no puede ser futura ni de más de un año atrás.
// Si no viene, se usa el momento actual.
function leerFecha(valor) {
  if (valor === undefined || valor === null || valor === '') return new Date()

  const fecha = new Date(valor)
  if (typeof valor !== 'string' || Number.isNaN(fecha.getTime())) {
    throw new ErrorHttp(400, 'La fecha no es válida')
  }

  const ahora = Date.now()
  const CINCO_MINUTOS = 5 * 60 * 1000
  const UN_AÑO = 366 * 24 * 60 * 60 * 1000

  if (fecha.getTime() > ahora + CINCO_MINUTOS) {
    throw new ErrorHttp(400, 'La fecha y la hora no pueden ser futuras')
  }
  if (fecha.getTime() < ahora - UN_AÑO) {
    throw new ErrorHttp(400, 'La fecha es demasiado antigua (máximo un año atrás)')
  }

  // Un pequeño desfase de reloj no puede dejar el pedido en el futuro
  return new Date(Math.min(fecha.getTime(), ahora))
}

// Los pedidos más recientes, con sus platos
router.get('/', async (req, res) => {
  const [filas] = await pool.query(
    `SELECT id, codigo, nombre_cliente, tipo_entrega, costo_envio,
            metodo_pago, total, estado, creado_en
     FROM pedidos
     ORDER BY creado_en DESC, id DESC
     LIMIT ?`,
    [MAXIMO_LISTA + 1],
  )

  const hayMas = filas.length > MAXIMO_LISTA
  const pedidos = filas.slice(0, MAXIMO_LISTA)

  const itemsPorPedido = new Map()
  if (pedidos.length > 0) {
    const [items] = await pool.query(
      `SELECT id, pedido_id, nombre_plato, variante, precio_unitario, cantidad
       FROM pedido_items
       WHERE pedido_id IN (?)
       ORDER BY id`,
      [pedidos.map((pedido) => pedido.id)],
    )

    for (const item of items) {
      const lista = itemsPorPedido.get(item.pedido_id) ?? []
      lista.push({
        id: item.id,
        nombre_plato: item.nombre_plato,
        variante: item.variante,
        precio_unitario: item.precio_unitario,
        cantidad: item.cantidad,
      })
      itemsPorPedido.set(item.pedido_id, lista)
    }
  }

  // total_pendientes y ultimo_id cuentan TODOS los pedidos, aunque la lista
  // traiga solo los más recientes
  const [[{ pendientes, ultimo }]] = await pool.query(
    `SELECT COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) AS pendientes,
            COALESCE(MAX(id), 0) AS ultimo
     FROM pedidos`,
  )

  res.json({
    pedidos: pedidos.map((pedido) => ({
      ...pedido,
      items: itemsPorPedido.get(pedido.id) ?? [],
    })),
    total_pendientes: pendientes,
    ultimo_id: ultimo,
    hay_mas: hayMas,
  })
})

// Carga un pedido hecho por fuera de la web (teléfono, mostrador, WhatsApp).
// Queda confirmado directamente y el total lo calcula el servidor.
router.post('/', async (req, res) => {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {}

  const nombre = String(cuerpo.nombre ?? '').trim()
  if (nombre.length < 1 || nombre.length > 120) {
    throw new ErrorHttp(400, 'El nombre es obligatorio y puede tener hasta 120 letras')
  }

  if (!TIPOS_ENTREGA.includes(cuerpo.tipo_entrega)) {
    throw new ErrorHttp(400, 'Tipo de entrega inválido')
  }

  if (!METODOS_PAGO.includes(cuerpo.metodo_pago)) {
    throw new ErrorHttp(400, 'Método de pago inválido')
  }

  const fecha = leerFecha(cuerpo.creado_en)
  const productos = validarProductos(cuerpo.items)

  // Se cargan también los platos no disponibles: puede ser un pedido de ayer
  const lineas = await calcularLineas(productos, { exigirDisponible: false })

  const [filasConfig] = await pool.query(
    'SELECT costo_envio FROM configuracion WHERE id = 1',
  )
  const costoEnvio = cuerpo.tipo_entrega === 'delivery' ? filasConfig[0].costo_envio : 0

  const subtotal = lineas.reduce(
    (suma, linea) => suma + linea.precioUnitario * linea.cantidad,
    0,
  )
  const total = subtotal + costoEnvio
  const codigo = generarCodigo()

  // El pedido y sus platos se guardan juntos: o entra todo o no entra nada
  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    const [resultado] = await conexion.query(
      `INSERT INTO pedidos
         (codigo, nombre_cliente, tipo_entrega, costo_envio, metodo_pago, total, estado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmado', ?)`,
      [codigo, nombre, cuerpo.tipo_entrega, costoEnvio, cuerpo.metodo_pago, total, fecha],
    )
    const pedidoId = resultado.insertId

    await conexion.query(
      `INSERT INTO pedido_items
         (pedido_id, plato_id, nombre_plato, variante, precio_unitario, cantidad)
       VALUES ?`,
      [
        lineas.map((linea) => [
          pedidoId,
          linea.platoId,
          linea.nombrePlato,
          linea.variante,
          linea.precioUnitario,
          linea.cantidad,
        ]),
      ],
    )

    await conexion.commit()
    res.status(201).json({ id: pedidoId, codigo, total })
  } catch (error) {
    await conexion.rollback()
    throw error
  } finally {
    conexion.release()
  }
})

// Marca un pedido como concretado
router.put('/:id/confirmar', async (req, res) => {
  const id = leerId(req)
  await exigirQueExista(id)

  await pool.query("UPDATE pedidos SET estado = 'confirmado' WHERE id = ?", [id])

  res.json({ ok: true })
})

// Borra los pedidos pendientes hasta el número indicado. Así no se borran
// los que entraron después de la última vez que el dueño miró la lista.
// Tiene que ir antes que la ruta de "/:id".
router.delete('/pendientes', async (req, res) => {
  const hasta = String(req.query.hasta ?? '')

  if (!/^\d+$/.test(hasta)) {
    throw new ErrorHttp(400, 'Falta indicar hasta qué pedido borrar')
  }

  const [resultado] = await pool.query(
    "DELETE FROM pedidos WHERE estado = 'pendiente' AND id <= ?",
    [Number(hasta)],
  )

  res.json({ borrados: resultado.affectedRows })
})

router.delete('/:id', async (req, res) => {
  const id = leerId(req)
  await exigirQueExista(id)

  // Los platos del pedido se borran solos
  await pool.query('DELETE FROM pedidos WHERE id = ?', [id])

  res.json({ ok: true })
})

export default router