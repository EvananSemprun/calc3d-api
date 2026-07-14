import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/**
 * Bloquea acciones SENSIBLES si el correo no está verificado (enforcement suave:
 * el usuario puede entrar y usar la app, pero no exponer nada hacia afuera —crear
 * links públicos, invitar gente— hasta confirmar su correo). Debe ir DESPUÉS del
 * JwtAuthGuard (necesita el `user` del request).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.emailVerified) {
      throw new ForbiddenException('Verifica tu correo para realizar esta acción');
    }
    return true;
  }
}
