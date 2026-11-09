import { Router } from 'express'
import { requerirSesion } from '../../auth.js'
import categoriasRouter from './categorias.js'
import configuracionRouter from './configuracion.js'
import estadisticasRouter from './estadisticas.js'
import imagenesRouter from './imagenes.js'
import novedadesRouter from './novedades.js'
import pedidosRouter from './pedidos.js'
import platosRouter from './platos.js'

const router = Router()

// Todo lo que cuelga de /api/admin exige haber iniciado sesión
router.use(requerirSesion)

router.use('/categorias', categoriasRouter)
router.use('/configuracion', configuracionRouter)
router.use('/estadisticas', estadisticasRouter)
router.use('/imagenes', imagenesRouter)
router.use('/novedades', novedadesRouter)
router.use('/pedidos', pedidosRouter)
router.use('/platos', platosRouter)

export default router