import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/**
 * Pipe que valida el body contra un schema Zod compartido con el frontend.
 * Devuelve los errores en español que define cada schema.
 *
 * ⚠️ **Dos parámetros de tipo, y el segundo no es adorno.** Antes era
 * `ZodSchema<T>`, que es `ZodType<T, ZodTypeDef, T>`: exige que lo que ENTRA y
 * lo que SALE sean el mismo tipo. Un schema con `.transform()` no lo cumple
 * —el de la query `?confirmoConciliacion=true` entra como texto y sale como
 * booleano— y no compilaba. Separar entrada de salida es lo que un pipe de
 * validación tiene que admitir: Zod existe justamente para convertir al
 * validar, no solo para decir que sí. Con el default `Entrada = Salida`, todas
 * las llamadas que ya existían siguen escribiéndose igual.
 */
export class ZodValidationPipe<Salida, Entrada = Salida>
  implements PipeTransform<unknown, Salida>
{
  constructor(private readonly schema: ZodType<Salida, ZodTypeDef, Entrada>) {}

  transform(value: unknown): Salida {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Datos inválidos',
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
