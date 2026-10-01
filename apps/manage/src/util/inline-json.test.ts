import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stringifyForInlineScript } from './inline-json.ts';

describe('stringifyForInlineScript', () => {
	it('produces valid JSON that parses back to the original value', () => {
		const value = {
			name: 'East Anglia ONE',
			nested: { markup: '<b>bold</b> & "quoted"', count: 3 },
			list: [1, 'two', null]
		};
		assert.deepStrictEqual(JSON.parse(stringifyForInlineScript(value)), value);
	});

	it('escapes </script> so stored data cannot terminate the host script element', () => {
		const json = stringifyForInlineScript({ name: 'x</script><img src=x onerror=alert(1)>' });
		assert.equal(json.includes('</script>'), false);
		assert.equal(json.includes('<img'), false);
		assert.match(json, /\\u003c\/script\\u003e/);
	});

	it('escapes <, > and & everywhere they appear', () => {
		const json = stringifyForInlineScript('a<b>c&d<!--e-->');
		assert.equal(json.includes('<'), false);
		assert.equal(json.includes('>'), false);
		assert.equal(json.includes('&'), false);
	});

	it('escapes the JS line separators U+2028 and U+2029', () => {
		const json = stringifyForInlineScript('a\u2028b\u2029c');
		assert.equal(json.includes('\u2028'), false);
		assert.equal(json.includes('\u2029'), false);
	});

	it('still produces undefined-safe output for plain values', () => {
		assert.equal(stringifyForInlineScript('plain text'), '"plain text"');
	});
});
