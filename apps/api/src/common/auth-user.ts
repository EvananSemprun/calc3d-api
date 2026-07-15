import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Usuario autenticado resuelto desde el JWT y adjuntado al request. */
export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  role: 'OWNER' | 'COLLABORATOR';
}

/** Inyecta el AuthUser del request en un parámetro del controlador. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
