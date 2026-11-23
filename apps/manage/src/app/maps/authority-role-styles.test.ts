import assert from 'node:assert';
import { describe, it } from 'node:test';
import { AUTHORITY_ROLE_STYLES, parseAuthorityRoleStyles } from './authority-role-styles.ts';

const VALID = `
version: 1
host: { colour: '#007a7a', description: teal }
bordering: { colour: '#f47738', description: ' orange ' }
`;

describe('authority role styles', () => {
	it('loads the shipped config/map-styles/authority-roles.yaml, a host and its neighbours in different colours', () => {
		assert.strictEqual(AUTHORITY_ROLE_STYLES.host.colour, '#007a7a');
		assert.notStrictEqual(AUTHORITY_ROLE_STYLES.bordering.colour, AUTHORITY_ROLE_STYLES.host.colour);
	});

	it('parses each role, trimming its description', () => {
		assert.deepStrictEqual(parseAuthorityRoleStyles(VALID), {
			host: { colour: '#007a7a', description: 'teal' },
			bordering: { colour: '#f47738', description: 'orange' }
		});
	});

	for (const [problem, text, message] of [
		['an empty file', '', /must be a version 1 document/],
		['another version', 'version: 2', /must be a version 1 document/],
		['an unknown role', `${VALID}\nneighbour: { colour: '#000000', description: black }`, /"neighbour"/],
		['a missing role', 'version: 1\nhost: { colour: "#007a7a", description: teal }', /bordering must be a style/],
		['a misspelt key', VALID.replace('description: teal', 'descripton: teal'), /host has "descripton"/],
		['a colour that is not hex', VALID.replace("'#007a7a'", 'teal'), /host\.colour must be a 6-digit hex colour/],
		['no description', VALID.replace("description: ' orange '", "description: ' '"), /bordering\.description/],
		['the same colour twice', VALID.replace("'#f47738'", "'#007A7A'"), /host and bordering need different colours/]
	] as const) {
		it(`refuses ${problem}`, () => {
			assert.throws(() => parseAuthorityRoleStyles(text), message);
		});
	}
});
