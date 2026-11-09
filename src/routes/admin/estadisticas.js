import { Router } from 'express'
import { pool } from '../../db.js'
import { ErrorHttp } from '../../errores.js'

const router = Router()

// Argentina está siempre en UTC-3 (no cambia la hora en verano)
const DESFASE_HORAS = 3
const DESFASE_MS = DESFASE_HORAS * 60 * 60 * 1000
const DIA_MS = 24 * 60 * 60 * 1000

const PERIODOS = ['hoy', '7dias', '30dias', 'mes']

// Cuántos días abarca el período, contando hoy
function diasDelPeriodo(periodo, diaDelMes) {
  switch (periodo) {
    case 'hoy':
      return 1
    case '7dias':
      return 7
    case '30dias':
      return 30
    default:
      // "mes": desde el día 1 hasta hoy
      return diaDelMes
  }
}

router.get('/', async (req, res) => {
  const periodo = String(req.query.periodo ?? '7dias')

  if (!PERIODOS.includes(periodo)) {
    throw new ErrorHttp(400, 'Período inválido')
  }

  // Los campos UTC de este "ahora corrido" son la fecha y la hora de Argentina
  const ahoraArgentina = new Date(Date.now() - DESFASE_MS)

  // El instante en que empezó hoy (las 00:00 de Argentina son las 03:00 UTC)
  const inicioHoy =
    Date.UTC(
      ahoraArgentina.getUTCFullYear(),
      ahoraArgentina.getUTCMonth(),
      ahoraArgentina.getUTCDate(),
    ) + DESFASE_MS

  const dias = diasDelPeriodo(periodo, ahoraArgentina.getUTCDate())
  const desdeMs = inicioHoy - (dias - 1) * DIA_MS
  const hastaMs = inicioHoy + DIA_MS

  const desde = new Date(desdeMs)
  const hasta = new Date(hastaMs)

  // Solo cuentan los pedidos confirmados
  const [[totales]] = await pool.query(
    `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS facturado
     FROM pedidos
     WHERE estado = 'confirmado' AND creado_en >= ? AND creado_en < ?`,
    [desde, hasta],
  )

  // Las fechas se guardan en UTC: se restan 3 horas para agrupar por día argentino
  const [filasPorDia] = await pool.query(
    `SELECT DATE_FORMAT(DATE_SUB(creado_en, INTERVAL ${DESFASE_HORAS} HOUR), '%Y-%m-%d') AS dia,
            COUNT(*) AS pedidos
     FROM pedidos
     WHERE estado = 'confirmado' AND creado_en >= ? AND creado_en < ?
     GROUP BY dia`,
    [desde, hasta],
  )

  // Se agrupa por el nombre que quedó en el pedido, así las opciones de un
  // mismo plato (media docena, docena) se suman juntas
  const [ranking] = await pool.query(
    `SELECT i.nombre_plato AS nombre, SUM(i.cantidad) AS unidades
     FROM pedido_items i
     JOIN pedidos p ON p.id = i.pedido_id
     WHERE p.estado = 'confirmado' AND p.creado_en >= ? AND p.creado_en < ?
     GROUP BY i.nombre_plato
     ORDER BY unidades DESC, i.nombre_plato
     LIMIT 10`,
    [desde, hasta],
  )

  // Una fila por cada día del período, aunque no haya tenido pedidos
  const pedidosPorDia = new Map(filasPorDia.map((fila) => [fila.dia, fila.pedidos]))
  const porDia = []
  for (let i = 0; i < dias; i++) {
    const dia = new Date(desdeMs + i * DIA_MS - DESFASE_MS).toISOString().slice(0, 10)
    porDia.push({ dia, pedidos: pedidosPorDia.get(dia) ?? 0 })
  }

  res.json({
    periodo,
    // SUM devuelve texto en mysql2, por eso se convierte a número
    pedidos: Number(totales.pedidos),
    facturado: Number(totales.facturado),
    por_dia: porDia,
    ranking: ranking.map((fila) => ({
      nombre: fila.nombre,
      unidades: Number(fila.unidades),
    })),
  })
})

export default router