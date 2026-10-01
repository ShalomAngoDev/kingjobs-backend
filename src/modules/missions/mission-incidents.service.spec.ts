import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionIncidentStatus,
  MissionIncidentType,
  MissionStatus,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import {
  insertMission,
  seedWorld,
  type World,
} from '../../../test/support/mission-fixtures';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionLifecycleService } from './mission-lifecycle.service';

describe('MissionIncidentsService', () => {
  let db: InMemoryPrisma;
  let world: World;
  let service: MissionIncidentsService;

  const past = () => new Date(Date.now() - 3_600_000);

  beforeEach(async () => {
    db = new InMemoryPrisma();
    world = await seedWorld(db);
    const prisma = db.asPrismaService();
    service = new MissionIncidentsService(
      prisma,
      new MissionLifecycleService(prisma),
    );
  });

  const confirmed = (overrides: Record<string, any> = {}) =>
    insertMission(db, world, {
      status: MissionStatus.CONFIRMED,
      selectedJobberUserId: world.jobber.id,
      scheduledStartAt: past(),
      ...overrides,
    });

  const description = 'Description de l’incident rencontré.';

  it('JOBBER_NO_SHOW reported by the client creates an OPEN incident without blocking', async () => {
    const mission = await confirmed();
    const result = await service.report(world.client.id, mission.id, {
      type: MissionIncidentType.JOBBER_NO_SHOW,
      description,
    });
    expect(result).toMatchObject({
      status: MissionIncidentStatus.OPEN,
      type: MissionIncidentType.JOBBER_NO_SHOW,
      blocksMission: false,
      missionStatus: MissionStatus.CONFIRMED,
    });
  });

  it('CLIENT_NO_SHOW reported by the jobber creates an OPEN incident', async () => {
    const mission = await confirmed();
    const result = await service.report(world.jobber.id, mission.id, {
      type: MissionIncidentType.CLIENT_NO_SHOW,
      description,
    });
    expect(result.status).toBe(MissionIncidentStatus.OPEN);
  });

  it('no-show with blocksMission moves the mission to DISPUTED with history', async () => {
    const mission = await confirmed();
    const result = await service.report(world.client.id, mission.id, {
      type: MissionIncidentType.JOBBER_NO_SHOW,
      description,
      blocksMission: true,
    });
    expect(result.missionStatus).toBe(MissionStatus.DISPUTED);
    expect(db.missionStatusHistory.rows.map((h) => h.toStatus)).toEqual([
      MissionStatus.DISPUTED,
    ]);
  });

  it('SAFETY always disputes the mission, even without blocksMission', async () => {
    const mission = await confirmed({
      status: MissionStatus.IN_PROGRESS,
      scheduledStartAt: null,
    });
    const result = await service.report(world.jobber.id, mission.id, {
      type: MissionIncidentType.SAFETY,
      description,
    });
    expect(result.blocksMission).toBe(true);
    expect(result.missionStatus).toBe(MissionStatus.DISPUTED);
  });

  it('a non-blocking quality incident leaves the mission untouched', async () => {
    const mission = await confirmed({ status: MissionStatus.IN_PROGRESS });
    const result = await service.report(world.client.id, mission.id, {
      type: MissionIncidentType.SERVICE_QUALITY,
      description,
    });
    expect(result.missionStatus).toBe(MissionStatus.IN_PROGRESS);
  });

  it('the wrong party cannot declare a no-show (403)', async () => {
    const mission = await confirmed();
    await expect(
      service.report(world.jobber.id, mission.id, {
        type: MissionIncidentType.JOBBER_NO_SHOW,
        description,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.report(world.client.id, mission.id, {
        type: MissionIncidentType.CLIENT_NO_SHOW,
        description,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a no-show before the scheduled start or once started', async () => {
    const future = await confirmed({
      scheduledStartAt: new Date(Date.now() + 3_600_000),
    });
    await expect(
      service.report(world.client.id, future.id, {
        type: MissionIncidentType.JOBBER_NO_SHOW,
        description,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const started = await confirmed({ status: MissionStatus.IN_PROGRESS });
    await expect(
      service.report(world.client.id, started.id, {
        type: MissionIncidentType.JOBBER_NO_SHOW,
        description,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('strangers get 404; draft/published/cancelled missions refuse incidents', async () => {
    const mission = await confirmed();
    await expect(
      service.report(world.jobber2.id, mission.id, {
        type: MissionIncidentType.OTHER,
        description,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    for (const status of [
      MissionStatus.DRAFT,
      MissionStatus.PUBLISHED,
      MissionStatus.CANCELLED,
    ]) {
      const m = await insertMission(db, world, {
        status,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        service.report(world.client.id, m.id, {
          type: MissionIncidentType.OTHER,
          description,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('a blocking incident on a COMPLETED mission is recorded but cannot dispute it', async () => {
    const mission = await confirmed({ status: MissionStatus.COMPLETED });
    const result = await service.report(world.client.id, mission.id, {
      type: MissionIncidentType.PAYMENT,
      description,
      blocksMission: true,
    });
    expect(result.missionStatus).toBe(MissionStatus.COMPLETED);
    expect(db.missionIncident.rows).toHaveLength(1);
  });

  describe('admin', () => {
    it('lists with filters and paginates', async () => {
      const mission = await confirmed();
      await service.report(world.client.id, mission.id, {
        type: MissionIncidentType.OTHER,
        description,
      });
      await service.report(world.jobber.id, mission.id, {
        type: MissionIncidentType.BEHAVIOR,
        description,
      });
      const all = await service.adminList({});
      expect(all.total).toBe(2);
      const filtered = await service.adminList({
        type: MissionIncidentType.BEHAVIOR,
      });
      expect(filtered.items).toHaveLength(1);
    });

    it('follows OPEN → UNDER_REVIEW → RESOLVED → CLOSED and sets resolvedAt', async () => {
      const mission = await confirmed();
      const incident = await service.report(world.client.id, mission.id, {
        type: MissionIncidentType.OTHER,
        description,
      });
      const review = await service.adminUpdateStatus(
        incident.id,
        MissionIncidentStatus.UNDER_REVIEW,
      );
      expect(review.resolvedAt).toBeNull();
      const resolved = await service.adminUpdateStatus(
        incident.id,
        MissionIncidentStatus.RESOLVED,
      );
      expect(resolved.resolvedAt).not.toBeNull();
      await service.adminUpdateStatus(
        incident.id,
        MissionIncidentStatus.CLOSED,
      );
      await expect(
        service.adminUpdateStatus(incident.id, MissionIncidentStatus.OPEN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on unknown incidents', async () => {
      await expect(
        service.adminUpdateStatus(
          '00000000-0000-4000-8000-000000000000',
          MissionIncidentStatus.CLOSED,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
