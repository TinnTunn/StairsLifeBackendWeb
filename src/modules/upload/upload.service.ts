import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type UploadType =
  | 'avatar'
  | 'ktm'
  | 'selfie'
  | 'deliverable'
  | 'evidence'
  | 'chat-image';

@Injectable()
export class UploadService {
  private readonly supabase: SupabaseClient;

  private readonly PUBLIC_BUCKET = 'stairslife-uploads'; // public  (avatars)
  private readonly PRIVATE_BUCKET = 'verification'; // private (ktm, selfie)
  private readonly DELIVERABLE_BUCKET = 'stairslife-private'; // private (deliverables)

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      this.config.get<string>('SUPABASE_URL'),
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
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
      const { data } = this.supabase.storage.from(bucket).getPublicUrl(path);
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
    // Validasi bentuk path DULU (cegah traversal ../ & path aneh yang bisa
    // mem-bypass cek owner di authorizeSignedUrlAccess).
    this.validatePathFormat(path);
    await this.authorizeSignedUrlAccess(path, requesterId, requesterRole);

    const isPrivateDeliverable =
      path.startsWith('deliverables/') || path.startsWith('evidence/');
    const bucket = isPrivateDeliverable
      ? this.DELIVERABLE_BUCKET
      : this.PRIVATE_BUCKET;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds, {
        // Paksa download untuk deliverable/evidence: tipe yang diizinkan
        // termasuk SVG yang bisa XSS kalau di-render inline di tab. ktm/selfie
        // (bucket verifikasi, hanya jpeg/png/webp) tetap inline untuk preview.
        ...(isPrivateDeliverable ? { download: true } : {}),
      });

    if (error || !data) {
      throw new InternalServerErrorException('Gagal membuat signed URL.');
    }

    return data.signedUrl;
  }

  /**
   * Validasi bentuk path: `folder/{uuid}/{filename}`. Folder hanya yang
   * dikenal, dan filename satu segmen (tanpa '/') sehingga '../' mustahil.
   */
  private validatePathFormat(path: string): void {
    const ok =
      /^(deliverables|ktm|selfie|evidence)\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/.test(
        path,
      );
    if (!ok) {
      throw new BadRequestException('Path file tidak valid.');
    }
  }

  // ─── Cek authorization sebelum buat signed URL ────────────────

  private async authorizeSignedUrlAccess(
    path: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<void> {
    if (requesterRole === 'admin') return;

    const segments = path.split('/');
    const folder = segments[0]; // 'deliverables', 'ktm', 'selfie'
    const ownerId = segments[1]; // userId

    if (folder === 'deliverables') {
      // Student pemilik file (uploader)
      if (requesterId === ownerId) return;

      // Business: HANYA boleh kalau file ini benar-benar deliverable dari salah
      // satu kontrak antara dia & student tsb. Sebelumnya cukup "pernah
      // berkontrak dgn student ini" — itu membocorkan deliverable lintas-klien
      // (bisnis A bisa lihat hasil kerja student utk bisnis B).
      const allowed = await this.isDeliverableForBusiness(
        path,
        ownerId,
        requesterId,
      );
      if (!allowed) {
        throw new ForbiddenException('Akses ditolak.');
      }
    } else {
      // ktm / selfie / evidence → hanya pemilik (admin sudah bypass di atas).
      // Untuk evidence, admin = mediator dispute yang perlu lihat bukti.
      if (requesterId !== ownerId) {
        throw new ForbiddenException('Akses ditolak.');
      }
    }
  }

  /**
   * True kalau `path` adalah deliverable dari kontrak antara studentId &
   * businessId. Dicocokkan via contracts.deliverable_url (deliverable terakhir,
   * bisa path tunggal atau JSON array) ATAU riwayat contract_deliverables.
   * Menutup kebocoran deliverable lintas-klien.
   */
  private async isDeliverableForBusiness(
    path: string,
    studentId: string,
    businessId: string,
  ): Promise<boolean> {
    // 1. Kontrak antara keduanya yang deliverable_url-nya mereferensikan path.
    const { data: c1 } = await this.supabase
      .from('contracts')
      .select('id')
      .eq('student_id', studentId)
      .eq('business_id', businessId)
      .like('deliverable_url', `%${path}%`)
      .limit(1);
    if (c1 && c1.length > 0) return true;

    // 2. Riwayat: contract_deliverables yang mereferensikan path → pastikan
    //    kontraknya milik business & student ini.
    const { data: hist } = await this.supabase
      .from('contract_deliverables')
      .select('contract_id')
      .like('deliverable_url', `%${path}%`);
    if (!hist || hist.length === 0) return false;

    const contractIds = hist.map((r: { contract_id: string }) => r.contract_id);
    const { data: c2 } = await this.supabase
      .from('contracts')
      .select('id')
      .in('id', contractIds)
      .eq('student_id', studentId)
      .eq('business_id', businessId)
      .limit(1);
    return !!(c2 && c2.length > 0);
  }

  // ─── Resolve bucket & path berdasarkan type ───────────────────

  private resolvePath(
    type: UploadType,
    userId: string,
    originalName: string,
  ): { bucket: string; path: string } {
    const ext = originalName.split('.').pop()?.toLowerCase() ?? 'bin';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const routes: Record<UploadType, { bucket: string; folder: string }> = {
      avatar: { bucket: this.PUBLIC_BUCKET, folder: `avatars/${userId}` },
      deliverable: {
        bucket: this.DELIVERABLE_BUCKET,
        folder: `deliverables/${userId}`,
      },
      ktm: { bucket: this.PRIVATE_BUCKET, folder: `ktm/${userId}` },
      selfie: { bucket: this.PRIVATE_BUCKET, folder: `selfie/${userId}` },
      // Bukti dispute — bucket privat, hanya pemilik & admin (mediator) yang
      // bisa minta signed URL (lihat authorizeSignedUrlAccess: cabang else).
      evidence: {
        bucket: this.DELIVERABLE_BUCKET,
        folder: `evidence/${userId}`,
      },
      // Gambar lampiran chat — public bucket supaya bisa di-render <img> langsung
      // di bubble chat. URL disisipkan ke message.content sebagai markdown
      // ![image](url). Bucket sama dgn avatar (public, free).
      'chat-image': { bucket: this.PUBLIC_BUCKET, folder: `chat/${userId}` },
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
