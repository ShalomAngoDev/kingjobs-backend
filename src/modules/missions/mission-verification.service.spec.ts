import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionApplicationStatus,
  MissionStatus,
  MissionVerificationType,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import {
  insertActiveAssignment,
  insertApplication,
  insertMission,
  seedWorld,
  type World,
} from '../../../test/support/mission-fixtures';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import { sha256Hex } from '../../common/utils/crypto-tokens';
import { MissionLifecycleService } from './mission-lifecycle.service';
import {
  hashVerificationSecret,
  MissionVerificationService,
} from './mission-verification.service';

describe('MissionVerificationService', () => {
  let db: InMemoryPrisma;
  let world: World;
  let service: MissionVerificationService;

  const wrongCode = (code: string) => (code === '0000' ? '9999' : '0000');

  beforeEach(async () => {
    db = new InMemoryPrisma();
    world = await seedWorld(db);
    const prisma = db.asPrismaService();
    service = new MissionVerificationService(
      prisma,
      new MissionLifecycleService(prisma),
    );
  });

  const confirmedMission = async (
    status: MissionStatus = MissionStatus.CONFIRMED,
  ) => {
    const mission = await insertMission(db, world, {
      status,
      selectedJobberUserId: world.jobber.id,
    });
    const app = await insertApplication(db, mission.id, world.jobber.id, {
      status: MissionApplicationStatus.SELECTED,
      selectedAt: new Date(),
    });
    await insertActiveAssignment(db, {
      missionId: mission.id,
      jobberUserId: world.jobber.id,
      applicationId: app.id,
      selectedByUserId: world.client.id,
    });
    return mission;
  };

  describe('generate', () => {
    it('returns a 4-digit code once and stores only its hash', async () => {
      const mission = await confirmedMission();
      const result = await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      );

      expect('code' in result && result.code).toMatch(/^\d{4}$/);
      const stored = db.missionVerification.rows[0];
      expect(stored.secretHash).toBe(
        hashVerificationSecret(
          mission.id,
          MissionVerificationType.START_CODE,
          (result as { code: string }).code,
        ),
      );
      expect(JSON.stringify(stored)).not.toContain(
        (result as { code: string }).code + '"',
      );
      expect(stored.secretHash).not.toBe((result as { code: string }).code);
      expect(stored.secretHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.maxAttempts).toBe(MISSION_LIMITS.START_CODE_MAX_ATTEMPTS);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns an opaque token for QR and stores only its hash', async () => {
      const mission = await confirmedMission();
      const result = await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_QR,
      );
      const token = (result as { token: string }).token;
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(db.missionVerification.rows[0].secretHash).not.toContain(token);
      expect(db.missionVerification.rows[0].secretHash).toBe(
        hashVerificationSecret(
          mission.id,
          MissionVerificationType.START_QR,
          token,
        ),
      );
      expect(sha256Hex(token)).not.toBe(
        db.missionVerification.rows[0].secretHash,
      );
    });

    it('invalidates the previous secret of the same type', async () => {
      const mission = await confirmedMission();
      const first = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };
      const second = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };
      const [oldRow] = db.missionVerification.rows;
      expect(oldRow.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

      if (first.code !== second.code) {
        await expect(
          service.validateStart(world.jobber.id, mission.id, {
            code: first.code,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('is reserved to the owner client', async () => {
      const mission = await confirmedMission();
      await expect(
        service.generate(
          world.jobber.id,
          mission.id,
          MissionVerificationType.START_CODE,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('start secrets require CONFIRMED/READY_TO_START, end secrets COMPLETION_PENDING', async () => {
      const pending = await confirmedMission(MissionStatus.PAYMENT_REQUIRED);
      await expect(
        service.generate(
          world.client.id,
          pending.id,
          MissionVerificationType.START_CODE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      const running = await confirmedMission(MissionStatus.IN_PROGRESS);
      await expect(
        service.generate(
          world.client.id,
          running.id,
          MissionVerificationType.END_CODE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      const completion = await confirmedMission(
        MissionStatus.COMPLETION_PENDING,
      );
      await expect(
        service.generate(
          world.client.id,
          completion.id,
          MissionVerificationType.END_QR,
        ),
      ).resolves.toHaveProperty('token');
    });
  });

  describe('validateStart', () => {
    it('valid code: CONFIRMED → IN_PROGRESS, code consumed, history written', async () => {
      const mission = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };

      const result = await service.validateStart(world.jobber.id, mission.id, {
        code,
      });

      expect(result.status).toBe(MissionStatus.IN_PROGRESS);
      expect(db.missionVerification.rows[0].usedAt).toBeInstanceOf(Date);
      expect(db.missionStatusHistory.rows.map((h) => h.toStatus)).toContain(
        MissionStatus.IN_PROGRESS,
      );
    });

    it('works from READY_TO_START with a QR token', async () => {
      const mission = await confirmedMission(MissionStatus.READY_TO_START);
      const { token } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_QR,
      )) as { token: string };
      const result = await service.validateStart(world.jobber.id, mission.id, {
        token,
      });
      expect(result.status).toBe(MissionStatus.IN_PROGRESS);
    });

    it('a used code cannot be replayed', async () => {
      const mission = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };
      await service.validateStart(world.jobber.id, mission.id, { code });
      await expect(
        service.validateStart(world.jobber.id, mission.id, { code }),
      ).rejects.toBeInstanceOf(ConflictException); // mission déjà IN_PROGRESS
    });

    it('wrong code increments attempts and does not start the mission', async () => {
      const mission = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };

      await expect(
        service.validateStart(world.jobber.id, mission.id, {
          code: wrongCode(code),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(db.missionVerification.rows[0].attempts).toBe(1);
      expect(
        (await db.mission.findUnique({ where: { id: mission.id } }))?.status,
      ).toBe(MissionStatus.CONFIRMED);
    });

    it('locks after max attempts even with the right code (429)', async () => {
      const mission = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };

      for (let i = 0; i < MISSION_LIMITS.START_CODE_MAX_ATTEMPTS; i += 1) {
        await expect(
          service.validateStart(world.jobber.id, mission.id, {
            code: wrongCode(code),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      const locked = service.validateStart(world.jobber.id, mission.id, {
        code,
      });
      await expect(locked).rejects.toBeInstanceOf(HttpException);
      await expect(locked).rejects.toMatchObject({ status: 429 });
      expect(
        (await db.mission.findUnique({ where: { id: mission.id } }))?.status,
      ).toBe(MissionStatus.CONFIRMED);
    });

    it('rejects an expired code', async () => {
      const mission = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };
      db.missionVerification.rows[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.validateStart(world.jobber.id, mission.id, { code }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires exactly one of code or token', async () => {
      const mission = await confirmedMission();
      await expect(
        service.validateStart(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.validateStart(world.jobber.id, mission.id, {
          code: '1234',
          token: 'x'.repeat(32),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the client cannot validate (403) and strangers get 404', async () => {
      const mission = await confirmedMission();
      await expect(
        service.validateStart(world.client.id, mission.id, { code: '1234' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.validateStart(world.jobber2.id, mission.id, { code: '1234' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a start code does not validate an end phase (wrong status)', async () => {
      const mission = await confirmedMission();
      await expect(
        service.validateEnd(world.jobber.id, mission.id, { code: '1234' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a start code of another mission is not accepted', async () => {
      const a = await confirmedMission();
      const b = await confirmedMission();
      const { code } = (await service.generate(
        world.client.id,
        a.id,
        MissionVerificationType.START_CODE,
      )) as { code: string };
      // b n'a aucun code actif
      await expect(
        service.validateStart(world.jobber.id, b.id, { code }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('validateEnd', () => {
    it('valid end code: COMPLETION_PENDING → COMPLETED', async () => {
      const mission = await confirmedMission(MissionStatus.COMPLETION_PENDING);
      const { code } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.END_CODE,
      )) as { code: string };

      const result = await service.validateEnd(world.jobber.id, mission.id, {
        code,
      });

      expect(result.status).toBe(MissionStatus.COMPLETED);
      expect(result.completedAt).not.toBeNull();
    });

    it('valid end QR completes the mission and invalidates sibling secrets', async () => {
      const mission = await confirmedMission(MissionStatus.COMPLETION_PENDING);
      await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.END_CODE,
      );
      const { token } = (await service.generate(
        world.client.id,
        mission.id,
        MissionVerificationType.END_QR,
      )) as { token: string };

      const result = await service.validateEnd(world.jobber.id, mission.id, {
        token,
      });
      expect(result.status).toBe(MissionStatus.COMPLETED);
      const codeRow = db.missionVerification.rows.find(
        (r) => r.type === MissionVerificationType.END_CODE,
      );
      expect(codeRow?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('refuses end validation while the mission is IN_PROGRESS', async () => {
      const mission = await confirmedMission(MissionStatus.IN_PROGRESS);
      await expect(
        service.validateEnd(world.jobber.id, mission.id, { code: '1234' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
