import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractsRepository } from './contracts.repository';
import { ApplicationsModule } from '../applications/applications.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ApplicationsModule, ProjectsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractsRepository],
  exports: [ContractsService, ContractsRepository],
})
export class ContractsModule {}
