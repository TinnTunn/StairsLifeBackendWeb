import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UploadService } from './upload.service';

const ALLOWED_EXT = /jpeg|jpg|png|webp|pdf/;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // POST /api/v1/upload
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, unique + extname(file.originalname));
        },
      }),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_EXT.test(extname(file.originalname).toLowerCase())) {
          return cb(
            new BadRequestException(
              'Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    this.uploadService.validateFile(file);

    const requestBase = `${req.protocol}://${req.get('host')}`;
    const url = this.uploadService.buildFileUrl(file.filename, requestBase);

    return this.uploadService.formatResponse(file, url);
  }
}

