DROP TABLE IF EXISTS "care"."routine_proposals" CASCADE;
DROP TABLE IF EXISTS "care"."routine_drafts" CASCADE;
DROP TYPE IF EXISTS "care"."RoutineProposalStatus" CASCADE;
DELETE FROM public."_prisma_migrations" WHERE migration_name LIKE '%glo187_routine_workspace%';
