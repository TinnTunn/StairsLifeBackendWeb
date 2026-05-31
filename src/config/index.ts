import { Module, Global } from '@nestjs/common';
import { SupabaseService } from './supabase.config';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [SupabaseService, PrismaService],
  exports: [SupabaseService, PrismaService],
})
export class DatabaseModule {}
