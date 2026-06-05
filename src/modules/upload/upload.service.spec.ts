import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          // UploadService memanggil createClient() di constructor — butuh URL
          // & key valid (format saja, tanpa koneksi nyata) agar tidak throw
          // "supabaseUrl is required".
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'SUPABASE_URL'
                ? 'https://example.supabase.co'
                : 'test-service-role-key',
          },
        },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
