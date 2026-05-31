import type { JwtUser } from '../../common/types/jwt-payload.type';
import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.id, dto);
  }

  @Get('contract/:contractId')
  getByContract(@Param('contractId') contractId: string) {
    return this.reviewsService.getByContract(contractId);
  }

  @Get('user/:userId')
  getByUser(@Param('userId') userId: string) {
    return this.reviewsService.getByUser(userId);
  }
}
