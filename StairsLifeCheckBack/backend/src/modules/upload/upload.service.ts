import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type UploadType = 'avatar' | 'ktm' | 'selfie' | 'deliverable';

@Injectable()
export class UploadService {
  private readonly supabase: SupabaseClient;

  private readonly PUBLIC_BUCKET      = 'stairslife-uploads'; // public  (avatars)
  private readonly PRIVATE_BUCKET     = 'verification';        // private (ktm, selfie)
  private readonly DELIVERABLE_BUCKET = 'stairslife-private';  // private (deliverables)

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      this.config.get<string>('SUPABASE_URL')!,
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }

  // ─── Upload ke Supabase Storage ───────────────────────────────

  async uploadFile(
    file: Express.Multer.File,
    type: UploadType,
    userId: string,
  ): Promise<string> {
    const { bucket, path } = this.resolvePath(type, userId, file.originalname);

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Gagal upload ke Supabase: ${error.message}`,
      );
    }

    // Public bucket → return public URL langsung
    if (bucket === this.PUBLIC_BUCKET) {
      const { data } = this.supabase.storage
        .from(bucket)
        .getPublicUrl(path);
      return data.publicUrl;
    }

    // Private bucket → simpan path ke DB,
    // tampilkan via getSignedUrl() saat dibutuhkan
    return path;
  }

  // ─── Signed URL untuk private files ──────────────────────────

  async getSignedUrl(
    path: string,
    requesterId: string,
    requesterRole: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    await this.authorizeSignedUrlAccess(path, requesterId, requesterRole);

    const bucket = path.startsWith('deliverables/')
      ? this.DELIVERABLE_BUCKET
      : this.PRIVATE_BUCKET;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data) {
      throw new InternalServerErrorException('Gagal membuat signed URL.');
    }

    return data.signedUrl;
  }

  // ─── Cek authorization sebelum buat signed URL ────────────────

  private async authorizeSignedUrlAccess(
    path: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    if (requesterRole === 'admin') return;

    const segments = path.split('/');
    const folder   = segments[0]; // 'deliverables', 'ktm', 'selfie'
    const ownerId  = segments[1]; // userId

    if (folder === 'deliverables') {
      // Student pemilik file
      if (requesterId === ownerId) return;

      // Business owner yang punya contract dengan student tsb
      const { data: contract } = await this.supabase
        .from('contracts')
        .select('id')
        .eq('student_id', ownerId)
        .eq('business_id', requesterId)
        .limit(1)
        .maybeSingle();

      if (!contract) {
        throw new ForbiddenException('Akses ditolak.');
      }
    } else {
      // ktm / selfie → hanya pemilik
      if (requesterId !== ownerId) {
        throw new ForbiddenException('Akses ditolak.');
      }
    }
  }

  // ─── Resolve bucket & path berdasarkan type ───────────────────

  private resolvePath(
    type: UploadType,
    userId: string,
    originalName: string,
  ): { bucket: string; path: string } {
    const ext    = originalName.split('.').pop()?.toLowerCase() ?? 'bin';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const routes: Record<UploadType, { bucket: string; folder: string }> = {
      avatar:      { bucket: this.PUBLIC_BUCKET,      folder: `avatars/${userId}` },
      deliverable: { bucket: this.DELIVERABLE_BUCKET, folder: `deliverables/${userId}` },
      ktm:         { bucket: this.PRIVATE_BUCKET,     folder: `ktm/${userId}` },
      selfie:      { bucket: this.PRIVATE_BUCKET,     folder: `selfie/${userId}` },
    };

    const { bucket, folder } = routes[type];
    return { bucket, path: `${folder}/${unique}` };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  validateFile(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan dalam request.');
    }
  }

  formatResponse(file: Express.Multer.File, url: string) {
    return {
      data: {
        url,
        file_name: file.originalname,
        size: file.size,
        mime_type: file.mimetype,
      },
      message: 'File berhasil diupload.',
    };
  }
}