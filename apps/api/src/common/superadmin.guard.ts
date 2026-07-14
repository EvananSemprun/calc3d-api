import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/**
 * Restringe una ruta al SUPERADMIN de la plataforma (Fase 7C). Distinto de los
 * roles por-organización (OWNER/COLLABORATOR). Debe ir DESPUÉS del JwtAuthGuard.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.isSuperadmin) {
      throw new ForbiddenException('Acceso restringido');
    }
    return true;
  }
}
