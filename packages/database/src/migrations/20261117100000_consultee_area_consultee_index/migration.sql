BEGIN TRY

BEGIN TRAN;

-- A consultee is looked up by name - consultee = a name, consultee LIKE a name start - on every
-- category page (sharedConsulteeNames) and every Add a consultee keystroke and submit
-- (findConsulteeAreasByName(Start)). Each of those read every row of its category: an expression
-- like LOWER(consultee) can't seek an index. The database collation is already case-insensitive
-- (SQL_Latin1_General_CP1_CI_AS, infrastructure/database.tf), so the comparisons need no LOWER at
-- all, and this plain index on (consulteeCategory, consultee) lets them seek. region is included
-- so the name lookups answer from the index alone; id rides along as the clustered key.
--
-- No computed column: a consultee_area table not made by create_consultee_area_dataset (data
-- processing's redevelopment uses its own schema) then only lacks an index - slower, not broken.
DECLARE @table SYSNAME;
DECLARE @sql NVARCHAR(MAX);
DECLARE quarter_tables CURSOR LOCAL FAST_FORWARD FOR
    SELECT [name] FROM sys.tables
    WHERE SCHEMA_NAME([schema_id]) = N'dbo'
        AND [name] LIKE N'consultee[_]area[_][0-9][0-9][0-9][0-9]Q[1-4]';
OPEN quarter_tables;
FETCH NEXT FROM quarter_tables INTO @table;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'CREATE NONCLUSTERED INDEX [consultee_area_consultee_idx]
        ON [dbo].' + QUOTENAME(@table) + N'([consulteeCategory], [consultee])
        INCLUDE ([region]);';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM quarter_tables INTO @table;
END;
CLOSE quarter_tables;
DEALLOCATE quarter_tables;

-- and the table a new quarter gets: as 20261112090000_consultee_area_representative_point left it,
-- plus the name-lookup index
EXEC(N'CREATE OR ALTER PROCEDURE [dbo].[create_consultee_area_dataset] @quarter NVARCHAR(6)
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
        [representativePoint] geography NULL,
        CONSTRAINT '' + QUOTENAME(@table + N''_pkey'') + N'' PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT '' + QUOTENAME(@table + N''_geometryType_ck'') + N'' CHECK ([geometryType] IN (N''''Point'''', N''''MultiPoint'''', N''''LineString'''', N''''MultiLineString'''', N''''Polygon'''', N''''MultiPolygon'''', N''''GeometryCollection'''')),
        CONSTRAINT '' + QUOTENAME(@table + N''_metadata_json_ck'') + N'' CHECK (ISJSON([metadata]) = 1)
    );
    CREATE NONCLUSTERED INDEX [consultee_area_consulteeCategory_idx] ON [dbo].'' + QUOTENAME(@table) + N''([consulteeCategory]);
    CREATE NONCLUSTERED INDEX [consultee_area_consultee_idx] ON [dbo].'' + QUOTENAME(@table) + N''([consulteeCategory], [consultee]) INCLUDE ([region]);
    CREATE SPATIAL INDEX [consultee_area_geometry_sidx] ON [dbo].'' + QUOTENAME(@table) + N''([geometry]) USING GEOGRAPHY_AUTO_GRID;
    CREATE SPATIAL INDEX [consultee_area_geometry_simplified_sidx] ON [dbo].'' + QUOTENAME(@table) + N''([geometrySimplified]) USING GEOGRAPHY_AUTO_GRID;'';
    EXEC sp_executesql @sql;
END');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
