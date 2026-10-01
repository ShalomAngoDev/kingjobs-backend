import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobbersController } from './jobbers.controller';

@Module({
  imports: [AuthModule],
  controllers: [JobbersController],
})
export class JobbersModule {}
