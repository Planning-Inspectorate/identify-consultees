import assert from 'node:assert';
import { describe, it } from 'node:test';
import { formatFileSize, rememberReportZip, rememberedReportZip } from './report-zip.ts';

describe('formatFileSize', () => {
	it('gives kilobytes under a megabyte and megabytes over it', () => {
		assert.strictEqual(formatFileSize(512), '1KB');
		assert.strictEqual(formatFileSize(43_000), '42KB');
		assert.strictEqual(formatFileSize(1_435_000), '1.4MB');
		assert.strictEqual(formatFileSize(25 * 1024 * 1024), '25MB');
	});
});

describe('remembered report ZIPs', () => {
	it('serves what was remembered for a download URL', () => {
		const report = { fileName: 'report.zip', contents: Buffer.from('zip bytes') };
		rememberReportZip('/consultees/a/report/download?ruleset=rs', report);
		assert.strictEqual(rememberedReportZip('/consultees/a/report/download?ruleset=rs'), report);
	});

	it('keeps only the newest few reports - each is tens of MB of process memory', () => {
		for (let i = 0; i < 7; i++) {
			rememberReportZip(`/download/${i}`, { fileName: `${i}.zip`, contents: Buffer.alloc(1) });
		}
		// the oldest are evicted once five are kept
		assert.strictEqual(rememberedReportZip('/download/0'), undefined);
		assert.strictEqual(rememberedReportZip('/download/1'), undefined);
		assert.ok(rememberedReportZip('/download/6'));
	});
});
