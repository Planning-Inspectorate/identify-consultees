const timeFormat = new Intl.DateTimeFormat('en-GB', {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	// explicit zone, not the server's TZ, so the same stored instant renders the same everywhere
	// (and tests don't depend on where they run)
	timeZone: 'Europe/London'
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/London'
});

/** "11:20, 19 Sep 2026" - the shapefile picker's per-file upload timestamp. */
export function formatUploadedAt(date: Date): string {
	return `${timeFormat.format(date)}, ${dateFormat.format(date)}`;
}
