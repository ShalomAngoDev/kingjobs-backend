import { Module } from '@nestjs/common';
import { JobberEligibilityService } from './jobber-eligibility.service';
import { JobberProfileCompletionService } from './jobber-profile-completion.service';
import { JobberServiceEligibilitySync } from './jobber-service-eligibility-sync.service';

@Module({
  providers: [
    JobberEligibilityService,
    JobberProfileCompletionService,
    JobberServiceEligibilitySync,
  ],
  exports: [
    JobberEligibilityService,
    JobberProfileCompletionService,
    JobberServiceEligibilitySync,
  ],
})
export class EligibilityModule {}
