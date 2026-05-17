import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UploadDeliverableDto } from './dto/upload-deliverable.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('bisnis')
  async create(@Body() dto: CreateContractDto, @CurrentUser() user: JwtUser) {
    return this.contractsService.createContract(dto, user.id);
  }

  @Get('my')
  async getMyContracts(@CurrentUser() user: JwtUser) {
    return this.contractsService.getMyContracts(user.id, user.role);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.contractsService.getContractById(id, user.id);
  }

  @Get(':id/deliverables')
  async getDeliverableHistory(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.contractsService.getDeliverableHistory(id, user.id);
  }

  @Patch(':id/deliverable')
  @UseGuards(RolesGuard)
  @Roles('mahasiswa')
  async uploadDeliverable(
    @Param('id') id: string,
    @Body() dto: UploadDeliverableDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.contractsService.uploadDeliverable(id, dto, user.id);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('bisnis')
  async approveDeliverable(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.contractsService.approveDeliverable(id, user.id);
  }

  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('bisnis')
  async rejectDeliverable(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: JwtUser,
  ) {
    return this.contractsService.rejectDeliverable(id, body, user.id);
  }
}
