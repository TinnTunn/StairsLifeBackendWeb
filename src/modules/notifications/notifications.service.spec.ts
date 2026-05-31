import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../../config/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        // Mock PrismaService — service tidak akan call DB di test
        { provide: PrismaService, useValue: {} },
        // Mock Gateway — service tidak akan push di test
        { provide: NotificationsGateway, useValue: { pushToUser: jest.fn(), pushUnreadCount: jest.fn() } },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
