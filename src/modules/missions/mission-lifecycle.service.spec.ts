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
  insertActiveAssignment,
  insertApplication,
  insertMission,
  insertPublishedMission,
  publishMissionThroughReview,
  createJobber,
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

  async function withAssignment(
    missionId: string,
    jobberUserId = world.jobber.id,
  ) {
    const app = await insertApplication(db, missionId, jobberUserId, {
      status: MissionApplicationStatus.SELECTED,
      selectedAt: new Date(),
    });
    await insertActiveAssignment(db, {
      missionId,
      jobberUserId,
      applicationId: app.id,
      selectedByUserId: world.client.id,
    });
  }

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

    it('allows the BO04 publication path and post-selection path', () => {
      const publicationPath: MissionStatus[] = [
        MissionStatus.DRAFT,
        MissionStatus.PAYMENT_REQUIRED,
        MissionStatus.PENDING_REVIEW,
        MissionStatus.PUBLISHED,
      ];
      for (let i = 0; i < publicationPath.length - 1; i += 1) {
        expect(canTransition(publicationPath[i], publicationPath[i + 1])).toBe(
          true,
        );
      }
      const executionPath: MissionStatus[] = [
        MissionStatus.PUBLISHED,
        MissionStatus.APPLICATION_SELECTED,
        MissionStatus.CONFIRMED,
        MissionStatus.READY_TO_START,
        MissionStatus.IN_PROGRESS,
        MissionStatus.COMPLETION_PENDING,
        MissionStatus.COMPLETED,
      ];
      for (let i = 0; i < executionPath.length - 1; i += 1) {
        expect(canTransition(executionPath[i], executionPath[i + 1])).toBe(true);
      }
    });
  });

  describe('submitForPayment + approveForPublication', () => {
    it('approves after payment review and refreshes snapshots', async () => {
      const mission = await insertMission(db, world, {
        serviceNameSnapshot: 'Ancien nom',
        riskFlags: ['DRIVING'],
        minimumAge: 16,
      });
      await db.service.update({
        where: { id: world.service.id },
        data: { name: 'Ménage pro' },
      });

      await lifecycle.submitForPayment(mission.id, world.client.id);
      await lifecycle.markPaymentConfirmed(mission.id, world.client.id);
      const published = await lifecycle.approveForPublication(
        mission.id,
        world.client.id,
      );

      expect(published.status).toBe(MissionStatus.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(published.serviceNameSnapshot).toBe('Ménage pro');
      expect(published.minimumAge).toBe(18);
      expect(historyOf(mission.id)).toContain('DRAFT->PAYMENT_REQUIRED');
      expect(historyOf(mission.id)).toContain('PENDING_REVIEW->PUBLISHED');
    });

    it('hides submit from a non-owner (404)', async () => {
      const mission = await insertMission(db, world);
      await expect(
        lifecycle.submitForPayment(mission.id, world.jobber.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([['UNVERIFIED'], ['PENDING'], ['NEEDS_CHANGES'], ['REJECTED']])(
      'refuses submit when the client identity is %s',
      async (identityVerificationStatus) => {
        const mission = await insertMission(db, world);
        await db.user.update({
          where: { id: world.client.id },
          data: { identityVerificationStatus },
        });
        await expect(
          lifecycle.submitForPayment(mission.id, world.client.id),
        ).rejects.toThrow(
          'Votre identité doit être vérifiée avant de publier une mission.',
        );
      },
    );

    it('rejects admin approve when the service has become inactive', async () => {
      const mission = await insertMission(db, world);
      await lifecycle.submitForPayment(mission.id, world.client.id);
      await lifecycle.markPaymentConfirmed(mission.id);
      await db.service.update({
        where: { id: world.service.id },
        data: { isActive: false },
      });
      await expect(
        lifecycle.approveForPublication(mission.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('selectApplication', () => {
    it('selects one Jobber, keeps others PENDING until mission is full, then CONFIRMED', async () => {
      const mission = await insertPublishedMission(db, world);
      const chosen = await insertApplication(db, mission.id, world.jobber.id);
      const other = await insertApplication(db, mission.id, world.jobber2.id);

      const result = await lifecycle.selectApplication(
        mission.id,
        chosen.id,
        world.client.id,
      );

      // workersNeeded=1 → plein → CONFIRMED ; l'autre candidature → MISSION_FILLED
      expect(result.status).toBe(MissionStatus.CONFIRMED);
      expect(result.selectedJobberUserId).toBe(world.jobber.id);
      expect(result.assignedAt).toBeInstanceOf(Date);
      expect(
        (await db.missionApplication.findUnique({ where: { id: chosen.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.SELECTED);
      expect(
        (await db.missionApplication.findUnique({ where: { id: other.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.MISSION_FILLED);
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
      expect(historyOf(mission.id)).toEqual([
        'PUBLISHED->APPLICATION_SELECTED',
        'APPLICATION_SELECTED->CONFIRMED',
      ]);
    });

    it('lets only one of two concurrent selections win when workersNeeded=1', async () => {
      const mission = await insertPublishedMission(db, world);
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
      expect(final?.status).toBe(MissionStatus.CONFIRMED);
      expect(final?.selectedJobberUserId).not.toBeNull();
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
    });

    it('keeps PUBLISHED when workersNeeded>1 until last slot is filled', async () => {
      const mission = await insertPublishedMission(db, world, {
        workersNeeded: 2,
        clientPriceAmount: 20_000,
        estimatedAmount: 20_000,
        rateAmount: 10_000,
        rateScope: 'PER_JOBBER',
      });
      const a = await insertApplication(db, mission.id, world.jobber.id);
      const b = await insertApplication(db, mission.id, world.jobber2.id);

      const afterFirst = await lifecycle.selectApplication(
        mission.id,
        a.id,
        world.client.id,
      );
      expect(afterFirst.status).toBe(MissionStatus.PUBLISHED);
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(1);

      const afterSecond = await lifecycle.selectApplication(
        mission.id,
        b.id,
        world.client.id,
      );
      expect(afterSecond.status).toBe(MissionStatus.CONFIRMED);
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(2);
    });

    it('rejects a second select when workersNeeded=1', async () => {
      const mission = await insertPublishedMission(db, world);
      const first = await insertApplication(db, mission.id, world.jobber.id);
      const second = await insertApplication(db, mission.id, world.jobber2.id);

      await lifecycle.selectApplication(mission.id, first.id, world.client.id);
      await expect(
        lifecycle.selectApplication(mission.id, second.id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows 10 selects then rejects the 11th when workersNeeded=10', async () => {
      const mission = await insertPublishedMission(db, world, {
        workersNeeded: 10,
        clientPriceAmount: 100_000,
        estimatedAmount: 100_000,
        rateAmount: 10_000,
        rateScope: 'PER_JOBBER',
      });
      const jobbers = [world.jobber, world.jobber2];
      for (let i = 0; i < 9; i += 1) {
        jobbers.push(await createJobber(db, world.service.id));
      }
      const apps = [];
      for (const jobber of jobbers) {
        apps.push(await insertApplication(db, mission.id, jobber.id));
      }

      for (let i = 0; i < 10; i += 1) {
        const result = await lifecycle.selectApplication(
          mission.id,
          apps[i].id,
          world.client.id,
        );
        if (i < 9) {
          expect(result.status).toBe(MissionStatus.PUBLISHED);
        } else {
          expect(result.status).toBe(MissionStatus.CONFIRMED);
        }
      }
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(10);
      await expect(
        lifecycle.selectApplication(mission.id, apps[10].id, world.client.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not transition to PAYMENT_REQUIRED when paymentConfirmedAt is set', async () => {
      const mission = await insertPublishedMission(db, world);
      const app = await insertApplication(db, mission.id, world.jobber.id);
      const result = await lifecycle.selectApplication(
        mission.id,
        app.id,
        world.client.id,
      );
      expect(result.status).toBe(MissionStatus.CONFIRMED);
      expect(historyOf(mission.id)).not.toContain(
        'APPLICATION_SELECTED->PAYMENT_REQUIRED',
      );
      expect(historyOf(mission.id)).toContain(
        'APPLICATION_SELECTED->CONFIRMED',
      );
    });

    it('cancelAssignment reopens a slot and returns to PUBLISHED when was full', async () => {
      const mission = await insertPublishedMission(db, world, {
        workersNeeded: 2,
        clientPriceAmount: 20_000,
        estimatedAmount: 20_000,
        rateAmount: 10_000,
        rateScope: 'PER_JOBBER',
      });
      const a = await insertApplication(db, mission.id, world.jobber.id);
      const b = await insertApplication(db, mission.id, world.jobber2.id);
      await lifecycle.selectApplication(mission.id, a.id, world.client.id);
      await lifecycle.selectApplication(mission.id, b.id, world.client.id);

      const assignment = await db.missionAssignment.findFirst({
        where: { missionId: mission.id, jobberUserId: world.jobber2.id },
      });
      expect(assignment).toBeTruthy();

      const afterCancel = await lifecycle.cancelAssignment({
        missionId: mission.id,
        assignmentId: assignment!.id,
        actorUserId: world.client.id,
        asClient: true,
        reason: 'Désistement démo',
      });
      expect(afterCancel.status).toBe(MissionStatus.PUBLISHED);
      expect(
        await db.missionAssignment.count({
          where: { missionId: mission.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
      expect(
        (
          await db.missionApplication.findUnique({
            where: { id: b.id },
          })
        )?.status,
      ).toBe(MissionApplicationStatus.ASSIGNMENT_CANCELLED);
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
    it('markPaymentConfirmed: publication PAYMENT_REQUIRED → PENDING_REVIEW', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
      });
      const result = await lifecycle.markPaymentConfirmed(mission.id);
      expect(result.status).toBe(MissionStatus.PENDING_REVIEW);
      expect(result.paymentConfirmedAt).toBeInstanceOf(Date);
      expect(historyOf(mission.id)).toEqual(['PAYMENT_REQUIRED->PENDING_REVIEW']);
    });

    it('markPaymentConfirmed: legacy post-selection → CONFIRMED', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        publishedAt: new Date(),
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
      await withAssignment(mission.id);
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
      await withAssignment(mission.id);
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
      await withAssignment(mission.id);
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
      await publishMissionThroughReview(
        lifecycle,
        mission.id,
        world.client.id,
        world.client.id,
      );
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await lifecycle.selectApplication(mission.id, app.id, world.client.id);
      await lifecycle.markReadyToStart(mission.id);
      await lifecycle.startMission(mission.id, world.jobber.id);
      await lifecycle.requestCompletion(mission.id, world.jobber.id);
      await lifecycle.completeMission(mission.id, world.jobber.id);

      expect(historyOf(mission.id)).toEqual([
        'DRAFT->PAYMENT_REQUIRED',
        'PAYMENT_REQUIRED->PENDING_REVIEW',
        'PENDING_REVIEW->PUBLISHED',
        'PUBLISHED->APPLICATION_SELECTED',
        'APPLICATION_SELECTED->CONFIRMED',
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
        workersNeeded: 1,
      });
      await withAssignment(mission.id);
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
