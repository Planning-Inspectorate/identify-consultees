/**
 * Serialise a value to JSON for embedding inside an inline
 * `<script type="application/json">` block rendered with `| safe` (see
 * views/partials/consultee-map-region.njk and views/map-layers-demo/view.njk).
 *
 * `JSON.stringify` does not escape `<`, so a stored value containing
 * `</script>` (case names, consultee names and references all come from
 * imported data, not from literals we control) would terminate the script
 * element early and inject arbitrary markup into the page - stored HTML
 * injection, even though the CSP blocks injected scripts from executing.
 * `>` and `&` are escaped for the same reason (e.g. `<!--` comment tricks),
 * and U+2028/U+2029 so the output stays safe if ever read as JS rather than
 * JSON. All escapes are valid JSON `\uXXXX` sequences, so `JSON.parse` on the
 * client side sees exactly the original data.
 */
export function stringifyForInlineScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}
