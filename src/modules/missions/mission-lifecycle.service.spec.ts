import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionApplicationStatus,
  MissionCancellationReason,
  MissionStatus,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import {
  insertApplication,
  insertMission,
  seedWorld,
  type World,
} from '../../../test/support/mission-fixtures';
import {
  canTransition,
  MISSION_TRANSITIONS,
  MissionLifecycleService,
} from './mission-lifecycle.service';

describe('MissionLifecycleService', () => {
  let db: InMemoryPrisma;
  let world: World;
  let lifecycle: MissionLifecycleService;

  const historyOf = (missionId: string) =>
    db.missionStatusHistory.rows
      .filter((h) => h.missionId === missionId)
      .map((h) => `${h.fromStatus}->${h.toStatus}`);

  beforeEach(async () => {
    db = new InMemoryPrisma();
    world = await seedWorld(db);
    lifecycle = new MissionLifecycleService(db.asPrismaService());
  });

  describe('state machine', () => {
    it('defines an entry for every MissionStatus', () => {
      for (const status of Object.values(MissionStatus)) {
        expect(MISSION_TRANSITIONS[status]).toBeDefined();
      }
    });

    it('forbids skipping steps (DRAFT → IN_PROGRESS, PUBLISHED → CONFIRMED)', () => {
      expect(
        canTransition(MissionStatus.DRAFT, MissionStatus.IN_PROGRESS),
      ).toBe(false);
      expect(
        canTransition(MissionStatus.PUBLISHED, MissionStatus.CONFIRMED),
      ).toBe(false);
      expect(
        canTransition(
          MissionStatus.PAYMENT_REQUIRED,
          MissionStatus.IN_PROGRESS,
        ),
      ).toBe(false);
    });

    it('treats COMPLETED and CANCELLED as terminal', () => {
      expect(MISSION_TRANSITIONS.COMPLETED).toHaveLength(0);
      expect(MISSION_TRANSITIONS.CANCELLED).toHaveLength(0);
    });

    it('allows the nominal path end to end', () => {
      const path: MissionStatus[] = [
        MissionStatus.DRAFT,
        MissionStatus.PUBLISHED,
        MissionStatus.APPLICATION_SELECTED,
        MissionStatus.PAYMENT_REQUIRED,
        MissionStatus.CONFIRMED,
        MissionStatus.READY_TO_START,
        MissionStatus.IN_PROGRESS,
        MissionStatus.COMPLETION_PENDING,
        MissionStatus.COMPLETED,
      ];
      for (let i = 0; i < path.length - 1; i += 1) {
        expect(canTransition(path[i], path[i + 1])).toBe(true);
      }
    });
  });

  describe('publish', () => {
    it('publishes a DRAFT, refreshes snapshots and minimumAge, writes history', async () => {
      const mission = await insertMission(db, world, {
        serviceNameSnapshot: 'Ancien nom',
        riskFlags: ['DRIVING'],
        minimumAge: 16,
      });
      await db.service.update({
        where: { id: world.service.id },
        data: { name: 'Ménage pro' },
      });

      const published = await lifecycle.publish(mission.id, world.client.id);

      expect(published.status).toBe(MissionStatus.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(published.serviceNameSnapshot).toBe('Ménage pro');
      expect(published.minimumAge).toBe(18);
      expect(historyOf(mission.id)).toEqual(['DRAFT->PUBLISHED']);
    });

    it('hides the mission from a non-owner (404)', async () => {
      const mission = await insertMission(db, world);
      await expect(
        lifecycle.publish(mission.id, world.jobber.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects publishing twice', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      await expect(
        lifecycle.publish(mission.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects publishing when the service has become inactive', async () => {
      const mission = await insertMission(db, world);
      await db.service.update({
        where: { id: world.service.id },
        data: { isActive: false },
      });
      await expect(
        lifecycle.publish(mission.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('selectApplication', () => {
    it('selects, rejects others and ends in PAYMENT_REQUIRED with 2 history rows', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const chosen = await insertApplication(db, mission.id, world.jobber.id);
      const other = await insertApplication(db, mission.id, world.jobber2.id);

      const result = await lifecycle.selectApplication(
        mission.id,
        chosen.id,
        world.client.id,
      );

      expect(result.status).toBe(MissionStatus.PAYMENT_REQUIRED);
      expect(result.selectedJobberUserId).toBe(world.jobber.id);
      expect(result.assignedAt).toBeInstanceOf(Date);
      expect(
        (await db.missionApplication.findUnique({ where: { id: chosen.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.SELECTED);
      expect(
        (await db.missionApplication.findUnique({ where: { id: other.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.REJECTED);
      expect(historyOf(mission.id)).toEqual([
        'PUBLISHED->APPLICATION_SELECTED',
        'APPLICATION_SELECTED->PAYMENT_REQUIRED',
      ]);
    });

    it('lets only one of two concurrent selections win', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const a = await insertApplication(db, mission.id, world.jobber.id);
      const b = await insertApplication(db, mission.id, world.jobber2.id);

      const results = await Promise.allSettled([
        lifecycle.selectApplication(mission.id, a.id, world.client.id),
        lifecycle.selectApplication(mission.id, b.id, world.client.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
        ConflictException,
      );
      const final = await db.mission.findUnique({ where: { id: mission.id } });
      expect(final?.status).toBe(MissionStatus.PAYMENT_REQUIRED);
      expect(final?.selectedJobberUserId).not.toBeNull();
    });

    it('rejects when the conditional lock updates no row (race lost)', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id);
      jest.spyOn(db.mission, 'updateMany').mockResolvedValueOnce({ count: 0 });

      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.missionStatusHistory.rows).toHaveLength(0);
      expect(
        (await db.missionApplication.findUnique({ where: { id: app.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.PENDING);
    });

    it('rolls back everything if the application was withdrawn meanwhile', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id);
      jest
        .spyOn(db.missionApplication, 'updateMany')
        .mockResolvedValueOnce({ count: 0 });

      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);

      const after = await db.mission.findUnique({ where: { id: mission.id } });
      expect(after?.status).toBe(MissionStatus.PUBLISHED);
      expect(after?.selectedJobberUserId).toBeNull();
      expect(db.missionStatusHistory.rows).toHaveLength(0);
    });

    it('rejects a non-PENDING application', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id, {
        status: MissionApplicationStatus.WITHDRAWN,
      });
      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an application belonging to another mission', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const otherMission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, otherMission.id, world.jobber.id);
      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.client.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects selection by someone who does not own the mission', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.jobber2.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects selection on a non-published mission', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.DRAFT,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await expect(
        lifecycle.selectApplication(mission.id, app.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('payment, start, completion', () => {
    it('markPaymentConfirmed: PAYMENT_REQUIRED → CONFIRMED with confirmedAt', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      const result = await lifecycle.markPaymentConfirmed(mission.id);
      expect(result.status).toBe(MissionStatus.CONFIRMED);
      expect(result.confirmedAt).toBeInstanceOf(Date);
      expect(historyOf(mission.id)).toEqual(['PAYMENT_REQUIRED->CONFIRMED']);
    });

    it('markPaymentConfirmed refuses any other source status', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      await expect(
        lifecycle.markPaymentConfirmed(mission.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([MissionStatus.CONFIRMED, MissionStatus.READY_TO_START])(
      'startMission works from %s',
      async (status) => {
        const mission = await insertMission(db, world, {
          status,
          selectedJobberUserId: world.jobber.id,
        });
        const result = await lifecycle.startMission(
          mission.id,
          world.jobber.id,
        );
        expect(result.status).toBe(MissionStatus.IN_PROGRESS);
        expect(result.startedAt).toBeInstanceOf(Date);
      },
    );

    it('startMission refuses PAYMENT_REQUIRED (payment not confirmed)', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.startMission(mission.id, world.jobber.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requestCompletion: selected jobber only, IN_PROGRESS → COMPLETION_PENDING', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.IN_PROGRESS,
        selectedJobberUserId: world.jobber.id,
      });
      const result = await lifecycle.requestCompletion(
        mission.id,
        world.jobber.id,
      );
      expect(result.status).toBe(MissionStatus.COMPLETION_PENDING);
      expect(result.completionRequestedAt).toBeInstanceOf(Date);
    });

    it('requestCompletion: client gets 403, unrelated jobber gets 404', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.IN_PROGRESS,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.requestCompletion(mission.id, world.client.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        lifecycle.requestCompletion(mission.id, world.jobber2.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requestCompletion refuses a mission that is not IN_PROGRESS', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.CONFIRMED,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.requestCompletion(mission.id, world.jobber.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('completeMission: COMPLETION_PENDING → COMPLETED, refuses IN_PROGRESS', async () => {
      const pending = await insertMission(db, world, {
        status: MissionStatus.COMPLETION_PENDING,
        selectedJobberUserId: world.jobber.id,
      });
      const done = await lifecycle.completeMission(pending.id, world.jobber.id);
      expect(done.status).toBe(MissionStatus.COMPLETED);
      expect(done.completedAt).toBeInstanceOf(Date);

      const running = await insertMission(db, world, {
        status: MissionStatus.IN_PROGRESS,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.completeMission(running.id, world.jobber.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('appends one history row per transition over the whole nominal flow', async () => {
      const mission = await insertMission(db, world);
      await lifecycle.publish(mission.id, world.client.id);
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await lifecycle.selectApplication(mission.id, app.id, world.client.id);
      await lifecycle.markPaymentConfirmed(mission.id);
      await lifecycle.markReadyToStart(mission.id);
      await lifecycle.startMission(mission.id, world.jobber.id);
      await lifecycle.requestCompletion(mission.id, world.jobber.id);
      await lifecycle.completeMission(mission.id, world.jobber.id);

      expect(historyOf(mission.id)).toEqual([
        'DRAFT->PUBLISHED',
        'PUBLISHED->APPLICATION_SELECTED',
        'APPLICATION_SELECTED->PAYMENT_REQUIRED',
        'PAYMENT_REQUIRED->CONFIRMED',
        'CONFIRMED->READY_TO_START',
        'READY_TO_START->IN_PROGRESS',
        'IN_PROGRESS->COMPLETION_PENDING',
        'COMPLETION_PENDING->COMPLETED',
      ]);
    });
  });

  describe('cancel', () => {
    const dto = {
      reasonCode: MissionCancellationReason.CLIENT_CHANGED_MIND,
      reasonText: ' plus besoin ',
    };

    it('client cancels a published mission: cancellation row + pending applications rejected', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const app = await insertApplication(db, mission.id, world.jobber.id);

      const result = await lifecycle.cancel(mission.id, world.client.id, dto);

      expect(result.status).toBe(MissionStatus.CANCELLED);
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(db.missionCancellation.rows).toHaveLength(1);
      expect(db.missionCancellation.rows[0]).toMatchObject({
        initiatedByUserId: world.client.id,
        actorType: 'CLIENT',
        previousStatus: MissionStatus.PUBLISHED,
        reasonText: 'plus besoin',
      });
      expect(
        (await db.missionApplication.findUnique({ where: { id: app.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.REJECTED);
      expect(historyOf(mission.id)).toEqual(['PUBLISHED->CANCELLED']);
    });

    it('selected jobber can cancel after selection', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      const result = await lifecycle.cancel(mission.id, world.jobber.id, {
        reasonCode: MissionCancellationReason.JOBBER_UNAVAILABLE,
      });
      expect(result.status).toBe(MissionStatus.CANCELLED);
      expect(db.missionCancellation.rows[0].actorType).toBe('JOBBER');
    });

    it('a non-selected jobber cannot cancel (404)', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.cancel(mission.id, world.jobber2.id, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      MissionStatus.IN_PROGRESS,
      MissionStatus.COMPLETION_PENDING,
      MissionStatus.COMPLETED,
      MissionStatus.CANCELLED,
    ])('client cannot cancel a mission in %s', async (status) => {
      const mission = await insertMission(db, world, {
        status,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.cancel(mission.id, world.client.id, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('dispute', () => {
    it('moves a CONFIRMED mission to DISPUTED with history', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.CONFIRMED,
        selectedJobberUserId: world.jobber.id,
      });
      const result = await lifecycle.dispute(
        mission.id,
        world.client.id,
        'Incident SAFETY',
      );
      expect(result.status).toBe(MissionStatus.DISPUTED);
      expect(historyOf(mission.id)).toEqual(['CONFIRMED->DISPUTED']);
    });

    it('refuses to dispute a COMPLETED mission', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.COMPLETED,
        selectedJobberUserId: world.jobber.id,
      });
      await expect(
        lifecycle.dispute(mission.id, world.client.id, 'x'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
