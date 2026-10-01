import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MissionsService } from '../src/modules/missions/missions.service';
import { e2eDb, MissionsE2eModule } from './missions-e2e.module';
import { createUser, seedWorld, type World } from './support/mission-fixtures';

describe('Missions API e2e (in-memory store)', () => {
  let app: INestApplication;
  let world: World;
  let admin: Record<string, any>;
  let missionsService: MissionsService;

  const as = (user: { id: string }) => ({ 'x-test-user-id': user.id });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MissionsE2eModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    missionsService = moduleRef.get(MissionsService);
    world = await seedWorld(e2eDb);
    admin = await createUser(e2eDb, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication on every route', async () => {
    await http().get('/api/v1/missions/available').expect(401);
    await http().post('/api/v1/missions').send({}).expect(401);
  });

  it('happy path: create → publish → apply → select returns PAYMENT_REQUIRED', async () => {
    // 1. Création (DRAFT)
    const created = await http()
      .post('/api/v1/missions')
      .set(as(world.client))
      .send({
        serviceId: world.service.id,
        title: 'Ménage appartement',
        description: 'Nettoyage complet de mon appartement de 3 pièces.',
        city: 'Cotonou',
        district: 'Fidjrossè',
        addressLine: '12 rue des Cocotiers',
        latitude: 6.3654,
        longitude: 2.4183,
        clientPriceAmount: 15000,
        scheduledStartAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      })
      .expect(201);
    const missionId = created.body.id as string;
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      currency: 'XOF',
      clientUserId: world.client.id,
    });
    expect(created.body.reference).toMatch(/^KJ-\d{4}-\d{6}$/);

    // Un brouillon n'est pas visible d'un Jobber
    await http()
      .get(`/api/v1/missions/${missionId}`)
      .set(as(world.jobber))
      .expect(404);

    // 2. Publication
    const published = await http()
      .post(`/api/v1/missions/${missionId}/publish`)
      .set(as(world.client))
      .expect(200);
    expect(published.body.status).toBe('PUBLISHED');

    // 3. Le Jobber la voit dans /available (route statique avant :id), sans adresse
    const available = await http()
      .get('/api/v1/missions/available')
      .set(as(world.jobber))
      .expect(200);
    expect(available.body.total).toBe(1);
    expect(available.body.items[0].id).toBe(missionId);
    expect(JSON.stringify(available.body)).not.toContain('Cocotiers');
    expect(available.body.items[0]).not.toHaveProperty('latitude');

    const publicDetail = await http()
      .get(`/api/v1/missions/${missionId}`)
      .set(as(world.jobber))
      .expect(200);
    expect(publicDetail.body).not.toHaveProperty('addressLine');

    // 4. Candidatures
    const application = await http()
      .post(`/api/v1/missions/${missionId}/applications`)
      .set(as(world.jobber))
      .send({ message: 'Disponible demain matin' })
      .expect(201);
    await http()
      .post(`/api/v1/missions/${missionId}/applications`)
      .set(as(world.jobber2))
      .send({})
      .expect(201);
    await http()
      .post(`/api/v1/missions/${missionId}/applications`)
      .set(as(world.jobber))
      .send({})
      .expect(409);

    const applications = await http()
      .get(`/api/v1/missions/${missionId}/applications`)
      .set(as(world.client))
      .expect(200);
    expect(applications.body.items).toHaveLength(2);
    expect(JSON.stringify(applications.body)).not.toMatch(
      /passwordHash|@example\.test|phone/,
    );

    // 5. Sélection → PAYMENT_REQUIRED
    const selected = await http()
      .post(
        `/api/v1/missions/${missionId}/applications/${application.body.id}/select`,
      )
      .set(as(world.client))
      .expect(200);
    expect(selected.body).toMatchObject({
      status: 'PAYMENT_REQUIRED',
      selectedJobberUserId: world.jobber.id,
    });

    // Le Jobber sélectionné voit désormais l'adresse
    const jobberDetail = await http()
      .get(`/api/v1/missions/${missionId}`)
      .set(as(world.jobber))
      .expect(200);
    expect(jobberDetail.body.addressLine).toBe('12 rue des Cocotiers');

    // 6. AUCUNE route de confirmation de paiement
    for (const path of [
      `/api/v1/missions/${missionId}/confirm-payment`,
      `/api/v1/missions/${missionId}/payment/confirm`,
      `/api/v1/missions/${missionId}/payments/confirm`,
    ]) {
      await http().post(path).set(as(world.client)).send({}).expect(404);
    }
    // et le statut ne peut pas être forcé par PATCH
    await http()
      .patch(`/api/v1/missions/${missionId}`)
      .set(as(world.client))
      .send({ status: 'CONFIRMED' })
      .expect(400);

    const history = await http()
      .get(`/api/v1/admin/missions/${missionId}/history`)
      .set(as(admin))
      .expect(200);
    expect(history.body.items.map((h: any) => h.toStatus)).toEqual([
      'DRAFT',
      'PUBLISHED',
      'APPLICATION_SELECTED',
      'PAYMENT_REQUIRED',
    ]);
  });

  it('full lifecycle: payment (internal) → start code → completion → end code → COMPLETED', async () => {
    const created = await http()
      .post('/api/v1/missions')
      .set(as(world.client))
      .send({
        serviceId: world.service.id,
        title: 'Ménage complet',
        description: 'Nettoyage de printemps de la maison entière.',
        city: 'Cotonou',
        clientPriceAmount: 20000,
      })
      .expect(201);
    const id = created.body.id as string;
    await http()
      .post(`/api/v1/missions/${id}/publish`)
      .set(as(world.client))
      .expect(200);
    const application = await http()
      .post(`/api/v1/missions/${id}/applications`)
      .set(as(world.jobber))
      .send({})
      .expect(201);
    await http()
      .post(`/api/v1/missions/${id}/applications/${application.body.id}/select`)
      .set(as(world.client))
      .expect(200);

    // Paiement : uniquement via le service interne (Backend 05)
    await missionsService.markPaymentConfirmed(id);

    const startCode = await http()
      .post(`/api/v1/missions/${id}/verifications/start-code`)
      .set(as(world.client))
      .expect(200);
    expect(startCode.body.code).toMatch(/^\d{4}$/);

    // Le client ne peut pas valider à la place du Jobber
    await http()
      .post(`/api/v1/missions/${id}/verifications/validate-start`)
      .set(as(world.client))
      .send({ code: startCode.body.code })
      .expect(403);

    const started = await http()
      .post(`/api/v1/missions/${id}/verifications/validate-start`)
      .set(as(world.jobber))
      .send({ code: startCode.body.code })
      .expect(200);
    expect(started.body.status).toBe('IN_PROGRESS');

    const pending = await http()
      .post(`/api/v1/missions/${id}/request-completion`)
      .set(as(world.jobber))
      .expect(200);
    expect(pending.body.status).toBe('COMPLETION_PENDING');

    const endQr = await http()
      .post(`/api/v1/missions/${id}/verifications/end-qr`)
      .set(as(world.client))
      .expect(200);
    const done = await http()
      .post(`/api/v1/missions/${id}/verifications/validate-end`)
      .set(as(world.jobber))
      .send({ token: endQr.body.token })
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');

    // Les secrets ne sont jamais stockés en clair
    const stored = JSON.stringify(e2eDb.missionVerification.rows);
    expect(stored).not.toContain(endQr.body.token);
  });

  it('rejects forged fields on creation (status, currency, owner)', async () => {
    await http()
      .post('/api/v1/missions')
      .set(as(world.client))
      .send({
        serviceId: world.service.id,
        title: 'Ménage forgé',
        description: 'Tentative de forcer des champs interdits.',
        city: 'Cotonou',
        clientPriceAmount: 15000,
        status: 'CONFIRMED',
        currency: 'USD',
        clientUserId: world.jobber.id,
      })
      .expect(400);
  });

  it('protects admin routes with roles', async () => {
    await http()
      .get('/api/v1/admin/missions')
      .set(as(world.client))
      .expect(403);
    const list = await http()
      .get('/api/v1/admin/missions')
      .set(as(admin))
      .expect(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    await http().get('/api/v1/admin/incidents').set(as(admin)).expect(200);
  });
});
