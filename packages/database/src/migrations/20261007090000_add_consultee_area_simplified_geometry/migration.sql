BEGIN TRY

BEGIN TRAN;

-- A simplified copy of each area's geometry (Douglas-Peucker, 10m tolerance), which ruleset distance
-- and bordering checks run against - far fewer points to compare than the original, which is kept
-- for drawing on the map. The 10m tolerance must match SIMPLIFY_TOLERANCE_METRES in
-- geospatial/consultee-areas.ts, which also maintains this column on every import.
ALTER TABLE [dbo].[consultee_area] ADD [geometrySimplified] geography NULL;

-- EXEC, not plain statements: SQL Server compiles the whole batch up front, before the column
-- above exists
EXEC('UPDATE [dbo].[consultee_area] SET [geometrySimplified] = [geometry].Reduce(10).MakeValid()');

EXEC('ALTER TABLE [dbo].[consultee_area] ALTER COLUMN [geometrySimplified] geography NOT NULL');

EXEC('CREATE SPATIAL INDEX [consultee_area_geometry_simplified_sidx] ON [dbo].[consultee_area]([geometrySimplified]) USING GEOGRAPHY_AUTO_GRID');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
