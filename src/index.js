import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { pool } from './db.js'
import { ErrorHttp } from './errores.js'
import adminRouter from './routes/admin/index.js'
import authRouter from './routes/auth.js'
import configuracionRouter from './routes/configuracion.js'
import menuRouter from './routes/menu.js'
import novedadesRouter from './routes/novedades.js'
import pedidosRouter from './routes/pedidos.js'

const app = express()
const PORT = process.env.PORT || 3001

// Detrás del proxy de Railway, así req.ip es la IP real del visitante
app.set('trust proxy', 1)

app.use(cors({ origin: process.env.FRONTEND_URL }))
// El pedido llega como text/plain para evitar la consulta previa de CORS
// (ver enviarPedido en frontend/src/api.js)
app.use(express.json({ type: ['application/json', 'text/plain'] }))

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, servicio: 'Lo de Chicho API', db: 'conectada' })
  } catch (error) {
    console.error('Error de base de datos:', error.message)
    res
      .status(500)
      .json({ ok: false, servicio: 'Lo de Chicho API', db: 'sin conexión' })
  }
})

app.use('/api/configuracion', configuracionRouter)
app.use('/api/menu', menuRouter)
app.use('/api/novedades', novedadesRouter)
app.use('/api/pedidos', pedidosRouter)
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)

// Errores esperados (400, 401, 409...) y errores inesperados (500)
app.use((error, req, res, next) => {
  if (error instanceof ErrorHttp) {
    return res.status(error.estado).json({ error: error.message })
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  console.error(error)
  res.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(PORT, (error) => {
  if (error) {
    console.error(
      `No se pudo iniciar la API en el puerto ${PORT}: ${error.message}`,
    )
    process.exit(1)
  }
  console.log(`API escuchando en http://localhost:${PORT}`)
})