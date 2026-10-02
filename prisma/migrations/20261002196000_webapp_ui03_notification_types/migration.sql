-- WEBAPP Jobber UI 03 : types notification candidature (DEV).
-- Ne pas appliquer automatiquement sur Neon production.

ALTER TYPE "UserNotificationType" ADD VALUE IF NOT EXISTS 'JOBBER_APPLICATION_SELECTED';
ALTER TYPE "UserNotificationType" ADD VALUE IF NOT EXISTS 'JOBBER_APPLICATION_REJECTED';
ALTER TYPE "UserNotificationType" ADD VALUE IF NOT EXISTS 'JOBBER_MISSION_FILLED';
