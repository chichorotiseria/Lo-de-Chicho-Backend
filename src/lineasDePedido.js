import { pool } from './db.js'
import { ErrorHttp } from './errores.js'

const MAX_PRODUCTOS = 50
const MAX_CANTIDAD = 50

const esEnteroPositivo = (n) => Number.isInteger(n) && n > 0

// Revisa la lista de productos de un pedido y la devuelve limpia
export function validarProductos(lista) {
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_PRODUCTOS) {
    throw new ErrorHttp(400, 'El pedido no tiene productos válidos')
  }

  return lista.map((item) => {
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
}

// Busca en la base el nombre y el precio actual de cada producto
export async function calcularLineas(productos, { exigirDisponible }) {
  const idsPlatos = [...new Set(productos.map((producto) => producto.platoId))]

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

  return productos.map((producto) => {
    const plato = platoPorId.get(producto.platoId)
    if (!plato) {
      throw new ErrorHttp(400, 'Un plato del pedido no existe')
    }
    if (exigirDisponible && !plato.disponible) {
      throw new ErrorHttp(409, `${plato.nombre} no está disponible`)
    }

    const variantesDelPlato = variantesPorPlato.get(plato.id) ?? []
    let variante = null
    let precio = plato.precio

    if (variantesDelPlato.length > 0) {
      variante = variantesDelPlato.find((v) => v.id === producto.varianteId)
      if (!variante) {
        throw new ErrorHttp(400, `Falta elegir una opción de ${plato.nombre}`)
      }
      precio = variante.precio
    } else if (producto.varianteId !== null) {
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
      cantidad: producto.cantidad,
    }
  })
}