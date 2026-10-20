BEGIN TRY

BEGIN TRAN;

-- Which version of an area this is, and the dates it applies from and until (null while
-- current) - the reference data export's current_version, valid_from and valid_to
ALTER TABLE [dbo].[consultee_area] ADD
    [currentVersion] INT NOT NULL CONSTRAINT [consultee_area_currentVersion_df] DEFAULT 1,
    [validFrom] DATE NULL,
    [validTo] DATE NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
