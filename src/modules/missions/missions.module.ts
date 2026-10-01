import { Module } from '@nestjs/common';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { AdminMissionsController } from './admin-missions.controller';
import { JobberMissionsController } from './jobber-missions.controller';
import { MissionApplicationsController } from './mission-applications.controller';
import { MissionApplicationsService } from './mission-applications.service';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionLifecycleService } from './mission-lifecycle.service';
import { MissionVerificationService } from './mission-verification.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

@Module({
  imports: [EligibilityModule],
  // Ordre important : les routes statiques (`available`, `me/jobber`) avant `GET :id`.
  controllers: [
    JobberMissionsController,
    MissionApplicationsController,
    MissionsController,
    AdminMissionsController,
  ],
  providers: [
    MissionsService,
    MissionLifecycleService,
    MissionApplicationsService,
    MissionVerificationService,
    MissionIncidentsService,
  ],
  // markPaymentConfirmed reste interne : exporté pour Backend 05, jamais exposé en HTTP.
  exports: [MissionsService, MissionLifecycleService],
})
export class MissionsModule {}
