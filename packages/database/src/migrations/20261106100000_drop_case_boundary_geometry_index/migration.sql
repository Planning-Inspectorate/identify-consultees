BEGIN TRY

BEGIN TRAN;

-- No query reads this index: the Nearby NSIPs search and the maps' window query use
-- geometrySimplified, and the screening never queries case_boundary by location. But every
-- import pays for it. A long linear scheme's boundary (a 250km route of 1,200 parts, 1 million
-- points) took about 250s to save with it, and 16s without, past the app's 45s request
-- timeout, so it could never be imported from CBOS. With a few hundred rows, a query that
-- needed one could scan the table instead.
DROP INDEX [case_boundary_geometry_sidx] ON [dbo].[case_boundary];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
