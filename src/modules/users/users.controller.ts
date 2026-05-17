import type { JwtUser } from '../../common/types/jwt-payload.type';
import { Controller, Get, Patch, Post, Body, UseGuards } from '@nestjs/common';
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
}
