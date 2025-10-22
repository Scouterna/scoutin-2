// One signup might be for multiple projects. To support this, one instance of
// Scoutin should be configurable with multiple data sources. A data source is
// typically a project in Scoutnet, but it could theoretically be something else
// in the future.
//
// This setup makes it possible to have one Scoutin instance for multiple
// Scoutnet projects, which is useful for bigger events such as Jamborees where
// group signups and volunteer signups might happen in different projects.
//
// Each data source must have a unique identifier, which is used for things like
// mapping signups to the correct data source.
