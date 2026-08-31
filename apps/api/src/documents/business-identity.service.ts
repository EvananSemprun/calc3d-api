import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Datos del negocio que encabezan y firman cualquier documento. */
export interface BusinessIdentity {
  emisor: string;
  rif: string;
  phone: string;
  address: string;
  signer: string;
  logo: { data: Buffer; mime: string } | null;
}

/**
 * Carga los datos del emisor (nombre de la organización + ficha del negocio en
 * Ajustes). Es la ÚNICA fuente de esos datos para los documentos: si mañana la
 * nota de entrega y la cotización se desincronizan, es porque alguien los leyó
 * por su cuenta en vez de usar esto.
 */
@Injectable()
export class BusinessIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async load(organizationId: string): Promise<BusinessIdentity> {
    const [org, settings] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.settings.findUnique({ where: { organizationId } }),
    ]);

    return {
      emisor: org?.name ?? 'Mi negocio',
      rif: settings?.businessRif ?? '',
      phone: settings?.businessPhone ?? '',
      address: settings?.businessAddress ?? '',
      signer: settings?.businessSigner ?? '',
      logo:
        settings?.logo && settings.logoMime
          ? { data: Buffer.from(settings.logo), mime: settings.logoMime }
          : null,
    };
  }
}
