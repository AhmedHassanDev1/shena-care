-- GLO-216 / GLO-215 F-03: possible adverse reactions get their own support case category.
ALTER TYPE "operations"."SupportCaseCategory" ADD VALUE 'safety_concern';
