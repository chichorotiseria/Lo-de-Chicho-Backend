import { Router } from 'express'
import { requerirSesion } from '../../auth.js'
import configuracionRouter from './configuracionRouter.js'

const router = Router()

// Todo lo que cuelga de /api/admin exige haber inicado sesión
router.use(requerirSesion)

router.use('/configuracion', configuracionRouter)

export default router