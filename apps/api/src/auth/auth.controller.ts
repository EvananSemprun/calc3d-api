import { Body, Controller, Get, Post, UseGuards, UsePipes } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ForgotPasswordSchema,
  LoginSchema,
  RefreshSchema,
  ResetPasswordSchema,
  type ForgotPasswordDto,
  type LoginDto,
  type RefreshDto,
  type ResetPasswordDto,
} from '@calc3d/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ProxyThrottlerGuard } from './throttler-proxy.guard';
import { AuthService } from './auth.service';

/**
 * Límite estricto para los endpoints sensibles a fuerza bruta. El resto de la
 * API no se throttlea acá.
 *
 * ⚠️ **Es 5 y no 10 porque el tope real es el DOBLE del que dice este
 * número.** El contador del throttler vive en la MEMORIA del proceso, y en
 * producción hay dos instancias atendiendo: cada una lleva el suyo, así que
 * un atacante dispone de `limit × instancias` por minuto.
 *
 * Medido contra producción el 2026-11-05, con el límite en 10: 13 intentos
 * seguidos no bloqueaban ninguno, 50 en paralelo bloqueaban 44, y 26 seguidos
 * cortaban recién en el **17** (con una sola instancia habrían cortado en el
 * 11; con tres, en ninguno). Las 24 consultas al health devolvieron la MISMA
 * versión, así que no es un despliegue viejo conviviendo: son dos del mismo.
 *
 * ⚠️ **Esto NO lo arregla `TRUST_PROXY`** (su valor es correcto) ni ninguna
 * variable: mientras el contador sea en memoria, el tope se multiplica por la
 * cantidad de instancias. El arreglo de fondo es un almacén compartido (Redis),
 * que hoy no se justifica para un negocio de un solo dueño. Si algún día
 * Railway escala a más instancias, este número se vuelve a quedar corto.
 */
const TIGHT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
@UseGuards(ProxyThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle(TIGHT)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @Throttle(TIGHT)
  forgot(@Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle(TIGHT)
  reset(@Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
