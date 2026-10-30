// Error con código HTTP, para responder 400, 409, etc. desde cualquier ruta
export class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje)
    this.estado = estado
  }
}