BEGIN TRY

BEGIN TRAN;

-- A representative point for each consultee area: a point guaranteed to lie on it (inside a
-- polygon, on a line) - OGC's PointOnSurface, as shapely's representative_point() is. The add page
-- ranks the consultees whose names start with what's typed by their distance from the site to this
-- point, which is quick, and then measures only the ones it shows exactly, from geometrySimplified.
-- SQL Server has PointOnSurface only for geometry, not geography, so each area goes to geometry
-- and back: its point lies on the simplified area, within 10m of the original.
--
-- Kept up to date on every load by loadConsulteeAreas (geospatial/consultee-areas.ts), with the
-- same expression. NULL is allowed, so an area with no point doesn't fail its load - the add page
-- falls back to the area's envelope centre.

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
    -- separate batches: SQL Server compiles a batch whole, before the column it adds exists
    SET @sql = N'ALTER TABLE [dbo].' + QUOTENAME(@table) + N' ADD [representativePoint] geography NULL';
    EXEC sp_executesql @sql;
    SET @sql = N'UPDATE [dbo].' + QUOTENAME(@table) + N' SET [representativePoint] = geography::STGeomFromWKB('
        + N'geometry::STGeomFromWKB([geometrySimplified].STAsBinary(), 4326).MakeValid().STPointOnSurface().STAsBinary(), 4326)';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM quarter_tables INTO @table;
END;
CLOSE quarter_tables;
DEALLOCATE quarter_tables;

-- and the table a new quarter gets: as 20261022090000_consultee_area_quarterly_datasets made it,
-- with the new column last, where ALTER TABLE put it on the existing ones
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
