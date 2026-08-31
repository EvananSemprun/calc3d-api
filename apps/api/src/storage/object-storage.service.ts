import { randomUUID } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Almacenamiento de objetos para las fotos del catálogo (Cloudflare R2, que es
 * compatible con S3 — de ahí el SDK de AWS).
 *
 * La foto NO pasa por la API: el panel pide una URL firmada y sube el archivo
 * directo al bucket. Si pasara por acá, cada imagen de varios MB chocaría contra
 * el límite del body y quemaría CPU y ancho de banda del servidor. La firma
 * acota tipo y tamaño; la confirmación posterior (`head`) es la que verifica que
 * lo subido sea realmente eso antes de registrarlo.
 *
 * El logo del negocio sigue en la base a propósito: es un archivo suelto por
 * organización, no un catálogo que crece.
 */

/** Minutos de vida de una URL firmada de subida. */
const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface UploadTarget {
  /** Clave del objeto en el bucket (lo que se guarda en `StoreImage.key`). */
  key: string;
  /** URL firmada para hacer PUT del archivo. */
  url: string;
  /** Cabeceras que el navegador DEBE enviar: la firma las incluye. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StoredObject {
  contentType: string | null;
  contentLength: number | null;
}

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('R2_BUCKET', '');
    this.publicUrlBase = (config.get<string>('R2_PUBLIC_URL') ?? '').replace(/\/+$/, '');

    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucket) {
      // No se rompe el arranque: el resto de la app funciona sin fotos. El error
      // aparece recién al intentar subir una, con un mensaje que dice qué falta.
      this.client = null;
      this.logger.warn(
        'Almacenamiento de fotos sin configurar (faltan variables R2_*). ' +
          'La carga de fotos del catálogo estará deshabilitada.',
      );
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** true si hay credenciales; el panel lo usa para avisar en vez de fallar al subir. */
  get configured(): boolean {
    return this.client !== null && !!this.publicUrlBase;
  }

  private require(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El almacenamiento de fotos no está configurado. Cargá las credenciales de R2 en el servidor.',
      );
    }
    return this.client;
  }

  /** URL pública de un objeto ya subido. */
  publicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }

  /**
   * Crea el destino de subida. La clave la genera el SERVIDOR: si viniera del
   * cliente podría apuntar a la carpeta de otra organización o pisar un archivo
   * existente.
   */
  async createUploadUrl(params: {
    organizationId: string;
    prefix: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTarget> {
    const client = this.require();
    const ext = params.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
    const key = `${params.organizationId}/${params.prefix}/${randomUUID()}.${ext}`;

    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: params.contentType,
        ContentLength: params.contentLength,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return {
      key,
      url,
      // Van firmadas: si el navegador manda otro tipo o tamaño, R2 rechaza el PUT.
      headers: {
        'Content-Type': params.contentType,
        'Content-Length': String(params.contentLength),
      },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /** Metadatos de un objeto, o null si no existe. */
  async head(key: string): Promise<StoredObject | null> {
    const client = this.require();
    try {
      const out = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        contentType: out.ContentType ?? null,
        contentLength: out.ContentLength ?? null,
      };
    } catch {
      return null;
    }
  }

  /** Borra un objeto. Silencioso si ya no está: borrar es idempotente. */
  async remove(key: string): Promise<void> {
    const client = this.require();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      // Un huérfano en el bucket es molesto, no grave: no vale tumbar el borrado
      // de la ficha por esto.
      this.logger.warn(`No se pudo borrar el objeto ${key}: ${(e as Error).message}`);
    }
  }
}
