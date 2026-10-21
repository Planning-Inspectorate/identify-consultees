BEGIN TRY

BEGIN TRAN;

-- Consultee areas a newer quarter's data replaced: loading a group of the reference data from a
-- later quarter than the one loaded moves the group's rows here first, labelled with their quarter
-- (seed/consultee-area-groups.ts), rather than deleting them. Same columns as consultee_area
-- less the simplified geometry, which is only for screening. No CHECK constraints: rows are moved
-- here with DELETE ... OUTPUT INTO, which a table with them can't take.
CREATE TABLE [dbo].[consultee_area_archive] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [consultee_area_archive_id_df] DEFAULT newid(),
    [consulteeAreaId] UNIQUEIDENTIFIER NOT NULL,
    [quarter] NVARCHAR(7) NOT NULL,
    [archivedAt] DATETIME2 NOT NULL CONSTRAINT [consultee_area_archive_archivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [geometry] geography NOT NULL,
    [geometryType] NVARCHAR(50) NOT NULL,
    [sourceId] NVARCHAR(200),
    [consulteeCategory] NVARCHAR(200),
    [consulteeGroup] NVARCHAR(100),
    [consulteeSubcategory] NVARCHAR(200),
    [consulteeSubcategoryDescription] NVARCHAR(500),
    [consultee] NVARCHAR(200),
    [region] NVARCHAR(100),
    [metadata] NVARCHAR(max) NOT NULL,
    [currentVersion] INT NOT NULL,
    [validFrom] DATE,
    [validTo] DATE,
    [lastUpdated] DATETIME2 NOT NULL,
    CONSTRAINT [consultee_area_archive_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [consultee_area_archive_quarter_consulteeCategory_idx] ON [dbo].[consultee_area_archive]([quarter], [consulteeCategory]);

-- Each time a group of the reference data was loaded: which file, the date its data is from (the
-- file name's), that date's quarter, and how many rows it loaded and archived. A group's latest
-- load says which quarter its rows are from.
CREATE TABLE [dbo].[reference_data_load] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [reference_data_load_id_df] DEFAULT newid(),
    [dataGroup] NVARCHAR(50) NOT NULL,
    [blobName] NVARCHAR(200) NOT NULL,
    [dataDate] DATE NOT NULL,
    [quarter] NVARCHAR(7) NOT NULL,
    [rowsLoaded] INT NOT NULL,
    [rowsArchived] INT NOT NULL CONSTRAINT [reference_data_load_rowsArchived_df] DEFAULT 0,
    [loadedAt] DATETIME2 NOT NULL CONSTRAINT [reference_data_load_loadedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [reference_data_load_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [reference_data_load_dataGroup_loadedAt_idx] ON [dbo].[reference_data_load]([dataGroup], [loadedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
