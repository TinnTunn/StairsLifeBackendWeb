import type { JwtUser } from '../../common/types/jwt-payload.type';
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateDisputeDto } from './dto/create-dispute.dto';

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateDisputeDto) {
    return this.disputesService.create(user.id, dto);
  }

  @Get('my')
  getMy(@CurrentUser() user: JwtUser) {
    return this.disputesService.getMy(user.id);
  }

  // GET /api/v1/disputes/:id — detail sengketa
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.disputesService.getById(id, user.id);
  }

  // POST /api/v1/disputes/:id/evidence — tambah bukti tambahan ke dispute
  @Post(':id/evidence')
  addEvidence(
    @Param('id') id: string,
    @Body() body: { evidence_url: string; description?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.disputesService.addEvidence(id, body, user.id);
  }
}
