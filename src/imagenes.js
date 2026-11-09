import 'dotenv/config'
import { v2 as cloudinary } from 'cloudinary'
import { ErrorHttp } from './errores.js'

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env

export const imagenesConfiguradas = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET,
)

if (imagenesConfiguradas) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  })
}

// Todas las fotos del sitio van dentro de esta carpeta de Cloudinary
const CARPETA_BASE = 'lo-de-chicho'
const CARPETAS_PERMITIDAS = ['novedades', 'platos']

function exigirConfiguracion() {
  if (!imagenesConfiguradas) {
    throw new ErrorHttp(
      503,
      'Las fotos todavía no están configuradas: faltan las claves de Cloudinary.',
    )
  }
}

// Cloudinary devuelve los errores como { error: { message } } y no como Error
const mensajeDe = (error) => error?.error?.message ?? error?.message ?? error

// El navegador sube la foto directo a Cloudinary. Para que se lo permita,
// el servidor le da una firma que vale unos minutos y solo para esta carpeta.
export function firmarSubida(carpeta) {
  exigirConfiguracion()

  if (!CARPETAS_PERMITIDAS.includes(carpeta)) {
    throw new ErrorHttp(400, 'Carpeta de fotos inválida')
  }

  const parametros = {
    timestamp: Math.round(Date.now() / 1000),
    folder: `${CARPETA_BASE}/${carpeta}`,
    allowed_formats: 'jpg,png,webp',
    // Achica las fotos enormes (por ejemplo las del celular)
    transformation: 'c_limit,w_1600,h_1600',
  }

  return {
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    signature: cloudinary.utils.api_sign_request(parametros, CLOUDINARY_API_SECRET),
    ...parametros,
  }
}

// Revisa la foto que viene en un formulario. Si no hay foto, devuelve nulls.
// Solo se aceptan fotos que estén en nuestra carpeta de Cloudinary.
export function validarImagen(url, id, carpeta) {
  const sinUrl = url === undefined || url === null || url === ''
  const sinId = id === undefined || id === null || id === ''

  if (sinUrl && sinId) return { url: null, id: null }
  if (sinUrl || sinId) throw new ErrorHttp(400, 'La foto está incompleta')

  exigirConfiguracion()

  const urlEsperada = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/`
  const prefijoId = `${CARPETA_BASE}/${carpeta}/`

  if (
    typeof url !== 'string' ||
    typeof id !== 'string' ||
    url.length > 500 ||
    id.length > 200 ||
    !url.startsWith(urlEsperada) ||
    !id.startsWith(prefijoId) ||
    !url.includes(id)
  ) {
    throw new ErrorHttp(400, 'La foto no es válida')
  }

  return { url, id }
}

// Se llaman SIN esperar la respuesta: si Cloudinary tarda o falla, el cambio
// del dueño ya se guardó. Lo peor que pasa es que quede una foto sin usar.
export async function borrarImagen(id) {
  if (!id || !imagenesConfiguradas) return

  try {
    await cloudinary.uploader.destroy(id, { invalidate: true, timeout: 15000 })
  } catch (error) {
    console.error(`No se pudo borrar la foto ${id} de Cloudinary:`, mensajeDe(error))
  }
}

export async function borrarImagenes(ids) {
  const lista = ids.filter(Boolean)
  if (lista.length === 0 || !imagenesConfiguradas) return

  // Cloudinary permite borrar hasta 100 por vez
  for (let i = 0; i < lista.length; i += 100) {
    try {
      await cloudinary.api.delete_resources(lista.slice(i, i + 100), {
        invalidate: true,
        timeout: 15000,
      })
    } catch (error) {
      console.error('No se pudieron borrar fotos de Cloudinary:', mensajeDe(error))
    }
  }
}

// Solo se permite borrar fotos que estén dentro de nuestra carpeta
export function esIdPropio(id) {
  return typeof id === 'string' && id.startsWith(`${CARPETA_BASE}/`) && id.length <= 200
}