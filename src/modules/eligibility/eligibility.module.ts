import { Module } from '@nestjs/common';
import { JobberEligibilityService } from './jobber-eligibility.service';
import { JobberProfileCompletionService } from './jobber-profile-completion.service';

@Module({
  providers: [JobberEligibilityService, JobberProfileCompletionService],
  exports: [JobberEligibilityService, JobberProfileCompletionService],
})
export class EligibilityModule {}
