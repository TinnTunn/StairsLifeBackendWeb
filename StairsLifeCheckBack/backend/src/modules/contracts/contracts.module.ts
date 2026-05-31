import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractsRepository } from './contracts.repository';
import { ApplicationsModule } from '../applications/applications.module';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ApplicationsModule, ProjectsModule, NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractsRepository],
  exports: [ContractsService, ContractsRepository],
})
export class ContractsModule {}
