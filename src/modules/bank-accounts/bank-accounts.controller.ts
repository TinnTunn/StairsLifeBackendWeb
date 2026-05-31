import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Endpoint rekening tujuan disbursement.
 *
 * Akses: hanya mahasiswa (mereka yang menerima dana). Bisnis tidak butuh
 * rekening karena pembayaran masuk dari Xendit ke escrow merchant kita.
 */
@Controller('bank-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('mahasiswa')
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Post()
  async create(
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.bankAccountsService.create(user.id, dto);
  }

  @Get()
  async list(@CurrentUser() user: JwtUser) {
    return this.bankAccountsService.findByUser(user.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bankAccountsService.findById(id, user.id);
  }

  @Patch(':id/primary')
  async setPrimary(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bankAccountsService.setPrimary(id, user.id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bankAccountsService.delete(id, user.id);
  }
}
