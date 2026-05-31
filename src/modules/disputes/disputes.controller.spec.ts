import { Test, TestingModule } from '@nestjs/testing';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

describe('DisputesController', () => {
  let controller: DisputesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputesController],
      providers: [{ provide: DisputesService, useValue: {} }],
    }).compile();

    controller = module.get<DisputesController>(DisputesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
