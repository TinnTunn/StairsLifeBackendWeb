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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // POST /api/v1/payments/escrow — bisnis hold dana
  @Post('escrow')
  @UseGuards(RolesGuard)
  @Roles('bisnis')
  async holdEscrow(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.paymentsService.holdEscrow(dto, user.id);
  }

  // PATCH /api/v1/payments/escrow/:id/release — bisnis release dana
  @Patch('escrow/:id/release')
  @UseGuards(RolesGuard)
  @Roles('bisnis')
  async releaseEscrow(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.paymentsService.releaseEscrow(id, user.id);
  }

  // GET /api/v1/payments/my — riwayat pembayaran
  @Get('my')
  async getMyPayments(@CurrentUser() user: JwtUser) {
    return this.paymentsService.getMyPayments(user.id);
  }

  // GET /api/v1/payments/contract/:contractId
  @Get('contract/:contractId')
  async getByContract(
    @Param('contractId') contractId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.paymentsService.getPaymentByContract(contractId, user.id);
  }
}
