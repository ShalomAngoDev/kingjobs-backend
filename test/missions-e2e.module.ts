import {
  CanActivate,
  ExecutionContext,
  Global,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { EligibilityModule } from '../src/modules/eligibility/eligibility.module';
import { AdminMissionsController } from '../src/modules/missions/admin-missions.controller';
import { JobberMissionsController } from '../src/modules/missions/jobber-missions.controller';
import { MissionApplicationsController } from '../src/modules/missions/mission-applications.controller';
import { MissionApplicationsService } from '../src/modules/missions/mission-applications.service';
import { MissionIncidentsService } from '../src/modules/missions/mission-incidents.service';
import { MissionLifecycleService } from '../src/modules/missions/mission-lifecycle.service';
import { MissionReviewService } from '../src/modules/missions/mission-review.service';
import { MissionVerificationService } from '../src/modules/missions/mission-verification.service';
import { EmailService } from '../src/infrastructure/email/email.service';
import { MissionsController } from '../src/modules/missions/missions.controller';
import { MissionsService } from '../src/modules/missions/missions.service';
import { InMemoryPrisma } from './support/in-memory-prisma';

export const e2eDb = new InMemoryPrisma();

/** Auth de test : `x-test-user-id` identifie l'utilisateur (pas de JWT dans cet e2e). */
@Injectable()
export class HeaderAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    const id = request.headers['x-test-user-id'];
    const user = id ? await e2eDb.user.findUnique({ where: { id } }) : null;
    if (!user) {
      throw new UnauthorizedException('Authentification requise.');
    }
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sessionId: 'test-session',
    };
    return true;
  }
}

/** Équivalent de PrismaModule (global) mais adossé au store en mémoire. */
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: e2eDb.asPrismaService() }],
  exports: [PrismaService],
})
export class E2ePrismaModule {}

/**
 * Module e2e dédié aux missions : vrais contrôleurs + vrais services,
 * Prisma remplacé par un store en mémoire (voir test/support/in-memory-prisma.ts).
 */
@Module({
  imports: [E2ePrismaModule, EligibilityModule],
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
    MissionReviewService,
    { provide: EmailService, useValue: { send: async () => undefined } },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: HeaderAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class MissionsE2eModule {}
