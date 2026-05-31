import {
  Controller,
  Post,
  Get,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UploadService, UploadType } from './upload.service';

const ALLOWED_EXT_IMAGE_DOC = /^(jpeg|jpg|png|webp|pdf)$/;
const ALLOWED_EXT_DELIVERABLE =
  /^(jpeg|jpg|png|webp|pdf|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|csv|txt|md|svg|gif|mp4|mov|mp3|wav|fig|psd|ai|sketch|xd|json)$/;

const MAX_SIZE_DEFAULT     = 10 * 1024 * 1024; // 10 MB
const MAX_SIZE_DELIVERABLE = 50 * 1024 * 1024; // 50 MB

const VALID_TYPES: UploadType[] = ['avatar', 'ktm', 'selfie', 'deliverable'];

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // ─── POST /upload ──────────────────────────────────────────────
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE_DELIVERABLE },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase().replace('.', '');
        const type = ((_req.body as any)?.type ?? '').toLowerCase();
        const allowed = type === 'deliverable'
          ? ALLOWED_EXT_DELIVERABLE
          : ALLOWED_EXT_IMAGE_DOC;

        if (!allowed.test(ext)) {
          return cb(
            new BadRequestException(
              type === 'deliverable'
                ? 'Format file tidak didukung untuk deliverable.'
                : 'Format tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    this.uploadService.validateFile(file);

    const type = ((req.body as any)?.type ?? '').toLowerCase() as UploadType;

    if (!VALID_TYPES.includes(type)) {
      throw new BadRequestException(
        `Type tidak valid. Gunakan: ${VALID_TYPES.join(', ')}`,
      );
    }

    if (type !== 'deliverable' && file.size > MAX_SIZE_DEFAULT) {
      throw new BadRequestException(
        'Ukuran file maksimal 10MB untuk avatar, KTM, dan selfie.',
      );
    }

    const userId = (req.user as any)?.id ?? (req.user as any)?.sub;
    if (!userId) {
      throw new BadRequestException('User tidak teridentifikasi.');
    }

    const url = await this.uploadService.uploadFile(file, type, userId);
    return this.uploadService.formatResponse(file, url);
  }

  // ─── GET /upload/signed-url?path=deliverables/userId/file.pdf ──
  @Get('signed-url')
  async getSignedUrl(
    @Query('path') path: string,
    @Req() req: Request,
  ) {
    if (!path) {
      throw new BadRequestException('Path tidak boleh kosong.');
    }

    const requesterId   = (req.user as any)?.id ?? (req.user as any)?.sub;
    const requesterRole = (req.user as any)?.role;

    const url = await this.uploadService.getSignedUrl(path, requesterId, requesterRole);
    return { data: { url } };
  }
}