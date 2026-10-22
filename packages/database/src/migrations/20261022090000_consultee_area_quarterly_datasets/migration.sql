BEGIN TRY

BEGIN TRAN;

-- The consultee areas are kept a quarter at a time, a table each - consultee_area_2026Q4 - named
-- for the quarter the data is from. Loading a group of the reference data (seed/consultee-area-
-- groups.ts) puts it in its quarter's table, made the first time it's needed; earlier quarters'
-- tables are kept as they are, as the archive. Everything that reads or writes consultee areas
-- uses the synonym consultee_area, which points at the dataset in use - the newest quarter whose
-- every group with data has been loaded - so none of its queries name a quarter. Today's data is
-- 2026Q4's.
EXEC sp_rename N'dbo.consultee_area', N'consultee_area_2026Q4';
EXEC(N'CREATE SYNONYM [dbo].[consultee_area] FOR [dbo].[consultee_area_2026Q4]');

-- the quarter tables replace the archive
DROP TABLE [dbo].[consultee_area_archive];

-- quarters as the tables name them: 2026-Q4 -> 2026Q4. Each load goes into its own quarter's
-- table now, so nothing is archived row by row
UPDATE [dbo].[reference_data_load] SET [quarter] = REPLACE([quarter], N'-', N'');
ALTER TABLE [dbo].[reference_data_load] DROP CONSTRAINT [reference_data_load_rowsArchived_df];
ALTER TABLE [dbo].[reference_data_load] DROP COLUMN [rowsArchived];

-- Making a quarter's table and switching the synonym are DDL, which the app's database user may
-- not have the rights for - these run with the owner's, and take only a quarter (2026Q4), which
-- they check. A quarter's table has consultee_area's columns, constraints (named for the table)
-- and indexes (named as consultee_area's, so the screening's index hints work on any of them).
EXEC(N'CREATE PROCEDURE [dbo].[create_consultee_area_dataset] @quarter NVARCHAR(6)
WITH EXECUTE AS OWNER
AS
BEGIN
    SET NOCOUNT ON;
    IF @quarter IS NULL OR LEN(@quarter) <> 6 OR @quarter NOT LIKE N''[0-9][0-9][0-9][0-9]Q[1-4]''
        THROW 50001, N''A dataset is named for its quarter, as in 2026Q4'', 1;
    DECLARE @table SYSNAME = N''consultee_area_'' + @quarter;
    IF OBJECT_ID(N''[dbo].'' + QUOTENAME(@table), N''U'') IS NOT NULL
        RETURN;
    DECLARE @sql NVARCHAR(MAX) = N''CREATE TABLE [dbo].'' + QUOTENAME(@table) + N'' (
        [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT '' + QUOTENAME(@table + N''_id_df'') + N'' DEFAULT newid(),
        [geometry] geography NOT NULL,
        [geometryType] NVARCHAR(50) NOT NULL,
        [consulteeCategory] NVARCHAR(200) NULL,
        [consultee] NVARCHAR(200) NULL,
        [region] NVARCHAR(100) NULL,
        [metadata] NVARCHAR(max) NOT NULL CONSTRAINT '' + QUOTENAME(@table + N''_metadata_df'') + N'' DEFAULT ''''{}'''',
        [lastUpdated] DATETIME2 NOT NULL CONSTRAINT '' + QUOTENAME(@table + N''_lastUpdated_df'') + N'' DEFAULT CURRENT_TIMESTAMP,
        [geometrySimplified] geography NOT NULL,
        [sourceId] NVARCHAR(200) NULL,
        [consulteeGroup] NVARCHAR(100) NULL,
        [consulteeSubcategory] NVARCHAR(200) NULL,
        [consulteeSubcategoryDescription] NVARCHAR(500) NULL,
        [currentVersion] INT NOT NULL CONSTRAINT '' + QUOTENAME(@table + N''_currentVersion_df'') + N'' DEFAULT 1,
        [validFrom] DATE NULL,
        [validTo] DATE NULL,
        CONSTRAINT '' + QUOTENAME(@table + N''_pkey'') + N'' PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT '' + QUOTENAME(@table + N''_geometryType_ck'') + N'' CHECK ([geometryType] IN (N''''Point'''', N''''MultiPoint'''', N''''LineString'''', N''''MultiLineString'''', N''''Polygon'''', N''''MultiPolygon'''', N''''GeometryCollection'''')),
        CONSTRAINT '' + QUOTENAME(@table + N''_metadata_json_ck'') + N'' CHECK (ISJSON([metadata]) = 1)
    );
    CREATE NONCLUSTERED INDEX [consultee_area_consulteeCategory_idx] ON [dbo].'' + QUOTENAME(@table) + N''([consulteeCategory]);
    CREATE SPATIAL INDEX [consultee_area_geometry_sidx] ON [dbo].'' + QUOTENAME(@table) + N''([geometry]) USING GEOGRAPHY_AUTO_GRID;
    CREATE SPATIAL INDEX [consultee_area_geometry_simplified_sidx] ON [dbo].'' + QUOTENAME(@table) + N''([geometrySimplified]) USING GEOGRAPHY_AUTO_GRID;'';
    EXEC sp_executesql @sql;
END');
EXEC(N'CREATE PROCEDURE [dbo].[use_consultee_area_dataset] @quarter NVARCHAR(6)
WITH EXECUTE AS OWNER
AS
BEGIN
    SET NOCOUNT ON;
    IF @quarter IS NULL OR LEN(@quarter) <> 6 OR @quarter NOT LIKE N''[0-9][0-9][0-9][0-9]Q[1-4]''
        THROW 50001, N''A dataset is named for its quarter, as in 2026Q4'', 1;
    DECLARE @table SYSNAME = N''consultee_area_'' + @quarter;
    IF OBJECT_ID(N''[dbo].'' + QUOTENAME(@table), N''U'') IS NULL
        THROW 50002, N''There is no consultee area dataset for that quarter'', 1;
    DECLARE @sql NVARCHAR(MAX) = N''CREATE SYNONYM [dbo].[consultee_area] FOR [dbo].'' + QUOTENAME(@table);
    BEGIN TRAN;
    IF OBJECT_ID(N''[dbo].[consultee_area]'', N''SN'') IS NOT NULL
        DROP SYNONYM [dbo].[consultee_area];
    EXEC sp_executesql @sql;
    COMMIT TRAN;
END');
EXEC(N'GRANT EXECUTE ON [dbo].[create_consultee_area_dataset] TO PUBLIC');
EXEC(N'GRANT EXECUTE ON [dbo].[use_consultee_area_dataset] TO PUBLIC');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
