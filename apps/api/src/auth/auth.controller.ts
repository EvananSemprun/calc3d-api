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

// Límite estricto para endpoints sensibles a fuerza bruta: 10 intentos por minuto
// por IP real. El resto de la API no se throttlea aquí.
const TIGHT = { default: { limit: 10, ttl: 60_000 } };

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
