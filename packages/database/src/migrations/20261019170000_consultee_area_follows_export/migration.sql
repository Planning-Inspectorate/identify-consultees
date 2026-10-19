BEGIN TRY

BEGIN TRAN;

-- consultee_area follows the reference data export's own fields: its id (sourceId), and the broad
-- group its consultee_category gives (consulteeGroup) - consulteeCategory stays the category the
-- rulesets match, from config/reference-data.yaml. The columns the export never fills go.
ALTER TABLE [dbo].[consultee_area] ADD [sourceId] NVARCHAR(200) NULL, [consulteeGroup] NVARCHAR(100) NULL;

-- EXEC, not plain statements: SQL Server compiles the whole batch up front, before the columns
-- above exist. Both were kept in metadata until now - move them out of it
EXEC('UPDATE [dbo].[consultee_area]
    SET [sourceId] = JSON_VALUE([metadata], ''$.sourceId''),
        [consulteeGroup] = JSON_VALUE([metadata], ''$.sourceCategory''),
        [metadata] = JSON_MODIFY(JSON_MODIFY(JSON_MODIFY([metadata], ''$.sourceId'', NULL), ''$.sourceCategory'', NULL), ''$.sourceLastUpdated'', NULL)
    WHERE ISJSON([metadata]) = 1');

DROP INDEX [consultee_area_caseReference_idx] ON [dbo].[consultee_area];
ALTER TABLE [dbo].[consultee_area] DROP CONSTRAINT [consultee_area_currentVersion_df];
ALTER TABLE [dbo].[consultee_area] DROP COLUMN [caseReference], [documentId], [consulteeId], [organisationId], [currentVersion];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
