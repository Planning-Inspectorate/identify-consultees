BEGIN TRY

BEGIN TRAN;

-- What kind of consultee an area is within its category, and what that means - the reference
-- data export's consultee_subcategory and consultee_subcategory_description: a port's Statutory
-- or NonStatutory, a railway's Active/Inactive, an interconnector's build status. Null where the
-- export gives none
ALTER TABLE [dbo].[consultee_area] ADD [consulteeSubcategory] NVARCHAR(200) NULL, [consulteeSubcategoryDescription] NVARCHAR(500) NULL;

-- metadata holds the export's attributes as JSON: refuse anything that isn't, so every reader
-- (JSON_VALUE, the report) can rely on it
ALTER TABLE [dbo].[consultee_area] ADD CONSTRAINT [consultee_area_metadata_json_ck] CHECK (ISJSON([metadata]) = 1);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
