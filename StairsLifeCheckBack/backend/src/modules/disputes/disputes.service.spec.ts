import { Test, TestingModule } from '@nestjs/testing';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('DisputesService', () => {
  let service: DisputesService;

  beforeEach(async () => {
    // Smoke test — semua dependency di-mock dengan empty objects.
    // Untuk tes behavior asli, ganti useValue dengan mock yang lebih realistis.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: PrismaService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<DisputesService>(DisputesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
