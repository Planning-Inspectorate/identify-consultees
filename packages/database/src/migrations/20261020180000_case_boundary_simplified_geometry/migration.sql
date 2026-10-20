BEGIN TRY

BEGIN TRAN;

-- A simplified copy of each boundary's geometry (Douglas-Peucker, 10m tolerance), which the
-- report's Nearby NSIPs distances run against: some boundaries hold over 100,000 points, too many
-- to measure between at page-load speed. The original is kept for drawing and for ruleset runs.
-- The 10m tolerance must match SIMPLIFY_TOLERANCE_METRES in geospatial/consultee-areas.ts, which
-- geospatial/case-boundaries.ts also uses to maintain this column on every load.
ALTER TABLE [dbo].[case_boundary] ADD [geometrySimplified] geography NULL;

-- EXEC, not plain statements: SQL Server compiles the whole batch up front, before the column
-- above exists
EXEC('UPDATE [dbo].[case_boundary] SET [geometrySimplified] = [geometry].Reduce(10).MakeValid()');

EXEC('ALTER TABLE [dbo].[case_boundary] ALTER COLUMN [geometrySimplified] geography NOT NULL');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
