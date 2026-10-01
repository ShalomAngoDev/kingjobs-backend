import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminMissionsController } from './admin-missions.controller';
import { JobberMissionsController } from './jobber-missions.controller';
import { MissionApplicationsController } from './mission-applications.controller';
import { MissionsController } from './missions.controller';
import { MissionsModule } from './missions.module';

type Controller = new (...args: never[]) => unknown;

function routesOf(controller: Controller): string[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') return [];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (method === undefined) return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const suffix = path === '/' ? '' : `/${path}`;
      return [`${RequestMethod[method]} /${base}${suffix}`];
    });
}

describe('missions HTTP surface', () => {
  const controllers: Controller[] = [
    JobberMissionsController,
    MissionApplicationsController,
    MissionsController,
    AdminMissionsController,
  ];
  const routes = controllers.flatMap(routesOf);

  it('exposes exactly the documented routes', () => {
    expect(routes.sort()).toEqual(
      [
        'GET /missions/available',
        'GET /missions/me/jobber',
        'POST /missions/:id/applications',
        'GET /missions/:id/applications',
        'POST /missions/:missionId/applications/:applicationId/select',
        'POST /missions/:missionId/applications/:applicationId/withdraw',
        'POST /missions',
        'GET /missions/me/client',
        'GET /missions/:id',
        'PATCH /missions/:id',
        'POST /missions/:id/publish',
        'POST /missions/:id/cancel',
        'POST /missions/:id/request-completion',
        'POST /missions/:id/verifications/start-code',
        'POST /missions/:id/verifications/start-qr',
        'POST /missions/:id/verifications/end-code',
        'POST /missions/:id/verifications/end-qr',
        'POST /missions/:id/verifications/validate-start',
        'POST /missions/:id/verifications/validate-end',
        'POST /missions/:id/incidents',
        'GET /admin/missions',
        'GET /admin/missions/:id',
        'GET /admin/missions/:id/history',
        'GET /admin/incidents',
        'PATCH /admin/incidents/:id/status',
      ].sort(),
    );
  });

  it('has NO payment confirmation route (internal-only markPaymentConfirmed)', () => {
    for (const route of routes) {
      expect(route.toLowerCase()).not.toMatch(/payment|confirm/);
    }
  });

  it('never exposes a route that writes the mission status directly', () => {
    expect(routes).not.toContain('PATCH /missions/:id/status');
    expect(routes).not.toContain('PUT /missions/:id');
  });

  it('registers static GET routes before GET /:id', () => {
    const registered = (
      Reflect.getMetadata('controllers', MissionsModule) as Controller[]
    ).flatMap(routesOf);
    const idx = (route: string) => registered.indexOf(route);
    expect(idx('GET /missions/available')).toBeLessThan(
      idx('GET /missions/:id'),
    );
    expect(idx('GET /missions/me/jobber')).toBeLessThan(
      idx('GET /missions/:id'),
    );
  });

  it('versions every controller as v1', () => {
    for (const controller of controllers) {
      expect(Reflect.getMetadata(VERSION_METADATA, controller)).toBe('1');
    }
  });

  it('restricts the admin controller to ADMIN / SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminMissionsController)).toEqual([
      'ADMIN',
      'SUPER_ADMIN',
    ]);
  });
});
