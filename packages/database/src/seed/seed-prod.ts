// Deliberately does nothing yet - production must never get seed-dev.ts's demo/sample data, only
// genuine static reference data (e.g. a fixed lookup table), and there isn't any of that to load
// yet. Kept as a real entry point (wired into the "Seed Prod SQL Database" deployment job) rather
// than removed, so whenever that data exists, loading it into production is already a one-line
// pipeline run away, not a new pipeline to build.
console.log('no production static data to seed yet');
