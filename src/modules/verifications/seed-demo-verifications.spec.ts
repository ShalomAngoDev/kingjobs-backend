import { assertActionAllowed, DbSafetyError } from '../../common/db/db-safety';
import {
  DEMO_CLIENT_EMAIL,
  DEMO_JOBBER_EMAIL,
} from '../../../prisma/seed-demo-verifications';

describe('seed demo verifications safeguards', () => {
  it('exports deterministic demo emails', () => {
    expect(DEMO_CLIENT_EMAIL).toBe('aicha.client.demo@kingjobs.test');
    expect(DEMO_JOBBER_EMAIL).toBe('junior.jobber.demo@kingjobs.test');
  });

  it('refuses seed-demo when DATABASE_ENV=production', () => {
    expect(() =>
      assertActionAllowed('seed-demo', {
        databaseEnv: 'production',
        databaseUrl:
          'postgresql://u:p@ep-prod.neon.tech/neondb?sslmode=require',
      }),
    ).toThrow(DbSafetyError);
  });

  it('allows seed-demo on development non-prod URL', () => {
    expect(() =>
      assertActionAllowed('seed-demo', {
        databaseEnv: 'development',
        databaseUrl: 'postgresql://u:p@localhost:5432/kingjobs_dev',
      }),
    ).not.toThrow();
  });
});
