import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './jwt.strategy';
import { resolveJwtSecret } from './jwt-secret';

@Module({
  imports: [
    PassportModule,
    MailModule,
    // Rate limiting (usado por AuthController con ProxyThrottlerGuard).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        // Access token CORTO: si se filtra, vale minutos, no días. La sesión se
        // mantiene viva con el refresh token rotatorio.
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
