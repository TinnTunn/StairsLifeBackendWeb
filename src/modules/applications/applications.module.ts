import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationsRepository } from './applications.repository';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationsRepository],
  exports: [ApplicationsService, ApplicationsRepository],
})
export class ApplicationsModule {}
