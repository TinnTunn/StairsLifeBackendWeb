import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Post('me/verification')
  async submitVerification(
    @CurrentUser() user: JwtUser,
    @Body() dto: SubmitVerificationDto,
  ) {
    return this.usersService.submitVerification(user.id, dto);
  }

  @Get('me/verification')
  async getVerificationStatus(@CurrentUser() user: JwtUser) {
    return this.usersService.getVerificationStatus(user.id);
  }

  /**
   * GET /users/:id — public profile.
   * Dipakai untuk melihat profile pihak lain (mahasiswa lihat bisnis, dst)
   * lengkap dengan rating & reviews. Tetap perlu login (auth guard di class level).
   */
  @Get(':id')
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getPublicProfile(id);
  }

  /**
   * GET /users/:id/portfolio — auto-portfolio dari completed contracts.
   * Bukan upload manual: berisi semua project yang sudah selesai user
   * sebagai mahasiswa, dengan info klien, kategori, rating yang didapat.
   *
   * Pakai pattern yang sama dengan getPublicProfile — endpoint :id (public),
   * dan me/portfolio (private alias untuk current user).
   */
  @Get(':id/portfolio')
  async getUserPortfolio(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getUserPortfolio(id);
  }
}
