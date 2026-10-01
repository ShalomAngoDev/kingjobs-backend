import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { JobbersController } from './jobbers.controller';
import { JobbersService } from './jobbers.service';

@Module({
  imports: [AuthModule, EligibilityModule],
  controllers: [JobbersController],
  providers: [JobbersService],
  exports: [JobbersService],
})
export class JobbersModule {}
