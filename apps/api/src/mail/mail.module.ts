import { Injectable, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Envío de correos transaccionales (verificación de email, reset de contraseña).
 *
 * Usa Resend cuando `RESEND_API_KEY` está configurada. Si NO lo está (desarrollo,
 * tests, o antes de configurar el proveedor), degrada a "modo dev": registra el
 * enlace en el log del servidor en vez de enviarlo. Así el flujo completo funciona
 * y se prueba sin depender de un servicio externo; enchufar Resend es solo poner la
 * variable de entorno. NUNCA se expone el token en la respuesta HTTP.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = this.config.get<string>('MAIL_FROM', 'Calc3D <onboarding@resend.dev>');
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:5173');
  }

  get devMode() {
    return this.resend === null;
  }

  async sendVerification(email: string, token: string) {
    const link = `${this.appUrl}/verify-email?token=${token}`;
    await this.send(
      email,
      'Verifica tu correo · Calc3D',
      `<p>¡Bienvenido a Calc3D!</p>
       <p>Confirma tu correo para activar tu cuenta:</p>
       <p><a href="${link}">Verificar mi correo</a></p>
       <p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
      link,
    );
  }

  async sendPasswordReset(email: string, token: string) {
    const link = `${this.appUrl}/reset-password?token=${token}`;
    await this.send(
      email,
      'Restablece tu contraseña · Calc3D',
      `<p>Recibimos una solicitud para restablecer tu contraseña.</p>
       <p><a href="${link}">Crear una nueva contraseña</a></p>
       <p>El enlace vence en 1 hora. Si no lo pediste, ignora este mensaje.</p>`,
      link,
    );
  }

  /** Aviso transaccional genérico (sin enlace): pago aprobado/rechazado, etc. */
  async sendNotice(to: string, subject: string, html: string) {
    if (!this.resend) {
      this.logger.warn(`[MODO DEV · sin RESEND_API_KEY] Aviso para ${to}: ${subject}`);
      return;
    }
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
    } catch (err) {
      this.logger.error(`Fallo al enviar aviso a ${to}: ${(err as Error).message}`);
    }
  }

  private async send(to: string, subject: string, html: string, link: string) {
    if (!this.resend) {
      // Modo dev: sin proveedor, deja el enlace en el log para poder probar.
      this.logger.warn(`[MODO DEV · sin RESEND_API_KEY] Correo para ${to}: ${link}`);
      return;
    }
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
    } catch (err) {
      // No filtrar el token; registrar solo el fallo. El caller no revela si el
      // correo existe (respuesta genérica), así que un fallo de envío no bloquea.
      this.logger.error(`Fallo al enviar correo a ${to}: ${(err as Error).message}`);
    }
  }
}

@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
