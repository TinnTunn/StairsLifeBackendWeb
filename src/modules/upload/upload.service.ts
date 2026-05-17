import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private config: ConfigService) {}

  /**
   * Bangun public URL file yang baru di-upload.
   * - Prioritas: PUBLIC_BASE_URL dari env (reverse proxy / Railway)
   * - Fallback: construct dari protocol + host yang diterima request
   */
  buildFileUrl(filename: string, requestBase: string): string {
    const base =
      this.config.get<string>('PUBLIC_BASE_URL') || requestBase;
    return `${base}/uploads/${filename}`;
  }

  /**
   * Validasi file yang di-upload sebelum disimpan.
   * Lempar BadRequestException jika tidak valid.
   */
  validateFile(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan dalam request');
    }
  }

  /**
   * Format response upload yang konsisten.
   */
  formatResponse(file: Express.Multer.File, url: string) {
    return {
      data: {
        url,
        file_name: file.originalname,
        saved_as: file.filename,
        size: file.size,
        mime_type: file.mimetype,
      },
      message: 'File berhasil diupload',
    };
  }
}

