BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[consultee_area] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [consultee_area_id_df] DEFAULT newid(),
    [geometry] geography NOT NULL,
    [geometryType] NVARCHAR(50) NOT NULL,
    [consulteeCategory] NVARCHAR(200),
    [consultee] NVARCHAR(200),
    [region] NVARCHAR(100),
    [caseReference] NVARCHAR(50),
    [documentId] UNIQUEIDENTIFIER,
    [consulteeId] UNIQUEIDENTIFIER,
    [organisationId] UNIQUEIDENTIFIER,
    [currentVersion] INT NOT NULL CONSTRAINT [consultee_area_currentVersion_df] DEFAULT 1,
    [metadata] NVARCHAR(max) NOT NULL CONSTRAINT [consultee_area_metadata_df] DEFAULT '{}',
    [lastUpdated] DATETIME2 NOT NULL CONSTRAINT [consultee_area_lastUpdated_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [consultee_area_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[case_boundary] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [case_boundary_id_df] DEFAULT newid(),
    [geometry] geography NOT NULL,
    [geometryType] NVARCHAR(50) NOT NULL,
    [caseReference] NVARCHAR(50) NOT NULL,
    [caseName] NVARCHAR(500) NOT NULL,
    [fileName] NVARCHAR(500),
    [receivedDate] DATETIME2,
    [acceptance] NVARCHAR(50),
    [metadata] NVARCHAR(max) NOT NULL CONSTRAINT [case_boundary_metadata_df] DEFAULT '{}',
    [lastUpdated] DATETIME2 NOT NULL CONSTRAINT [case_boundary_lastUpdated_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [case_boundary_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [consultee_area_caseReference_idx] ON [dbo].[consultee_area]([caseReference]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [consultee_area_consulteeCategory_idx] ON [dbo].[consultee_area]([consulteeCategory]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [case_boundary_caseReference_idx] ON [dbo].[case_boundary]([caseReference]);

-- CreateCheckConstraint
-- geometryType is not a Prisma enum: SQL Server has no native enum type Prisma can target, so this
-- is enforced with a hand-added CHECK constraint (Prisma has no schema-level way to express it).
ALTER TABLE [dbo].[consultee_area] ADD CONSTRAINT [consultee_area_geometryType_ck] CHECK ([geometryType] IN (N'Point', N'MultiPoint', N'LineString', N'MultiLineString', N'Polygon', N'MultiPolygon', N'GeometryCollection'));

ALTER TABLE [dbo].[case_boundary] ADD CONSTRAINT [case_boundary_geometryType_ck] CHECK ([geometryType] IN (N'Point', N'MultiPoint', N'LineString', N'MultiLineString', N'Polygon', N'MultiPolygon', N'GeometryCollection'));

-- CreateSpatialIndex
-- Prisma has no spatial index type, so these are hand-added too. Without one, STDistance/
-- STIntersects queries against these columns full-scan the table.
CREATE SPATIAL INDEX [consultee_area_geometry_sidx] ON [dbo].[consultee_area]([geometry]) USING GEOGRAPHY_AUTO_GRID;

CREATE SPATIAL INDEX [case_boundary_geometry_sidx] ON [dbo].[case_boundary]([geometry]) USING GEOGRAPHY_AUTO_GRID;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
