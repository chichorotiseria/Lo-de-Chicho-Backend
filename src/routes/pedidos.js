import { Router } from 'express'
import { pool } from '../db.js'
import { ErrorHttp } from '../errores.js'

const router = Router()

const TIPOS_ENTREGA = ['retiro', 'delivery']
const METODOS_PAGO = ['efectivo', 'transferencia']
const MAX_PRODUCTOS = 50
const MAX_CANTIDAD = 50

const esEnteroPositivo = (n) => Number.isInteger(n) && n > 0

// Revisa que el pedido tenga la forma esperada y devuelve los datos ya limpios
function validar(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') {
    throw new ErrorHttp(400, 'Pedido inválido')
  }

  const codigo = String(cuerpo.codigo ?? '').toUpperCase()
  if (!/^[A-Z0-9]{4,12}$/.test(codigo)) {
    throw new ErrorHttp(400, 'Código inválido')
  }

  const nombre = String(cuerpo.nombre ?? '').trim()
  if (nombre.length < 1 || nombre.length > 120) {
    throw new ErrorHttp(400, 'Nombre inválido')
  }

  if (!TIPOS_ENTREGA.includes(cuerpo.tipo_entrega)) {
    throw new ErrorHttp(400, 'Tipo de entrega inválido')
  }

  if (!METODOS_PAGO.includes(cuerpo.metodo_pago)) {
    throw new ErrorHttp(400, 'Método de pago inválido')
  }

  if (
    !Array.isArray(cuerpo.items) ||
    cuerpo.items.length === 0 ||
    cuerpo.items.length > MAX_PRODUCTOS
  ) {
    throw new ErrorHttp(400, 'El pedido no tiene productos válidos')
  }

  const items = cuerpo.items.map((item) => {
    const platoId = Number(item?.plato_id)
    const varianteId = item?.variante_id == null ? null : Number(item.variante_id)
    const cantidad = Number(item?.cantidad)

    if (
      !esEnteroPositivo(platoId) ||
      (varianteId !== null && !esEnteroPositivo(varianteId)) ||
      !esEnteroPositivo(cantidad) ||
      cantidad > MAX_CANTIDAD
    ) {
      throw new ErrorHttp(400, 'Producto inválido')
    }

    return { platoId, varianteId, cantidad }
  })

  return {
    codigo,
    nombre,
    tipoEntrega: cuerpo.tipo_entrega,
    metodoPago: cuerpo.metodo_pago,
    items,
  }
}

// Recibe un pedido y lo guarda como pendiente
router.post('/', async (req, res) => {
  const pedido = validar(req.body)

  const [filasConfig] = await pool.query(
    'SELECT local_abierto, costo_envio FROM configuracion WHERE id = 1',
  )
  const config = filasConfig[0]

  if (!config.local_abierto) {
    throw new ErrorHttp(409, 'El local está cerrado')
  }

  // Los precios y nombres salen de la base, no de lo que mande el navegador
  const idsPlatos = [...new Set(pedido.items.map((item) => item.platoId))]

  const [platos] = await pool.query(
    'SELECT id, nombre, precio, disponible FROM platos WHERE id IN (?)',
    [idsPlatos],
  )
  const [variantes] = await pool.query(
    'SELECT id, plato_id, nombre, precio FROM variantes WHERE plato_id IN (?)',
    [idsPlatos],
  )

  const platoPorId = new Map(platos.map((plato) => [plato.id, plato]))
  const variantesPorPlato = new Map()
  for (const variante of variantes) {
    const lista = variantesPorPlato.get(variante.plato_id) ?? []
    lista.push(variante)
    variantesPorPlato.set(variante.plato_id, lista)
  }

  const lineas = pedido.items.map((item) => {
    const plato = platoPorId.get(item.platoId)
    if (!plato) {
      throw new ErrorHttp(400, 'Un plato del pedido no existe')
    }
    if (!plato.disponible) {
      throw new ErrorHttp(409, `${plato.nombre} no está disponible`)
    }

    const variantesDelPlato = variantesPorPlato.get(plato.id) ?? []
    let variante = null
    let precio = plato.precio

    if (variantesDelPlato.length > 0) {
      variante = variantesDelPlato.find((v) => v.id === item.varianteId)
      if (!variante) {
        throw new ErrorHttp(400, `Falta elegir una opción de ${plato.nombre}`)
      }
      precio = variante.precio
    } else if (item.varianteId !== null) {
      throw new ErrorHttp(400, 'Opción inválida')
    }

    if (precio === null) {
      throw new ErrorHttp(400, `${plato.nombre} no tiene precio`)
    }

    return {
      platoId: plato.id,
      nombrePlato: plato.nombre,
      variante: variante ? variante.nombre : null,
      precioUnitario: precio,
      cantidad: item.cantidad,
    }
  })

  const subtotal = lineas.reduce(
    (suma, linea) => suma + linea.precioUnitario * linea.cantidad,
    0,
  )
  const costoEnvio = pedido.tipoEntrega === 'delivery' ? config.costo_envio : 0
  const total = subtotal + costoEnvio

  // El pedido y sus platos se guardan juntos: entra todo o no entra nada
  const conexion = await pool.getConnection()
  try {
    await conexion.beginTransaction()

    const [resultado] = await conexion.query(
      `INSERT INTO pedidos
         (codigo, nombre_cliente, tipo_entrega, costo_envio, metodo_pago, total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pedido.codigo,
        pedido.nombre,
        pedido.tipoEntrega,
        costoEnvio,
        pedido.metodoPago,
        total,
      ],
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
    res.status(201).json({ id: pedidoId, codigo: pedido.codigo, total })
  } catch (error) {
    await conexion.rollback()
    throw error
  } finally {
    conexion.release()
  }
})

export default router