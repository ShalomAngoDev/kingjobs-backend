import {
  CanActivate,
  ExecutionContext,
  Global,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AdminUsersController } from '../src/modules/admin-users/admin-users.controller';
import { AdminUsersService } from '../src/modules/admin-users/admin-users.service';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { SessionsService } from '../src/modules/auth/sessions.service';
import { EligibilityModule } from '../src/modules/eligibility/eligibility.module';
import { AdminUsersFakePrisma } from './support/admin-users-fake-prisma';

export const adminDb = new AdminUsersFakePrisma();

/** Auth de test : `x-test-user-id` identifie l'appelant (pas de JWT). */
@Injectable()
export class AdminHeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    const id = request.headers['x-test-user-id'];
    const user = adminDb.users.find((u) => u.id === id);
    if (!user) throw new UnauthorizedException('Authentification requise.');
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

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: adminDb.asPrismaService() }],
  exports: [PrismaService],
})
export class AdminE2ePrismaModule {}

/** Vrai contrôleur + vrai service ; seule la révocation de sessions est simulée. */
@Module({
  imports: [AdminE2ePrismaModule, EligibilityModule],
  controllers: [AdminUsersController],
  providers: [
    AdminUsersService,
    {
      provide: SessionsService,
      useValue: {
        revokeAllUserSessions: (userId: string) => {
          adminDb.revokedSessionsFor.push(userId);
          return Promise.resolve();
        },
      },
    },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: AdminHeaderAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AdminUsersE2eModule {}
