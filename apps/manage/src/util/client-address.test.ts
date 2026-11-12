import assert from 'node:assert';
import { describe, it } from 'node:test';
import { clientAddressKey } from './client-address.ts';

describe('clientAddressKey', () => {
	it("is Front Door's client address where it sends one, not the edge's", () => {
		assert.strictEqual(
			clientAddressKey({ ip: '147.243.0.10', headers: { 'x-azure-clientip': ' 203.0.113.7 ' } }),
			'203.0.113.7'
		);
		assert.strictEqual(
			clientAddressKey({ ip: '147.243.0.10', headers: { 'x-azure-clientip': ['203.0.113.8', '198.51.100.1'] } }),
			'203.0.113.8'
		);
	});

	it("is the request's own address without one - locally", () => {
		assert.strictEqual(clientAddressKey({ ip: '127.0.0.1', headers: {} }), '127.0.0.1');
		assert.strictEqual(clientAddressKey({ ip: '127.0.0.1', headers: { 'x-azure-clientip': ' ' } }), '127.0.0.1');
		assert.strictEqual(clientAddressKey({ ip: undefined, headers: {} }), '');
	});

	it('keys an IPv6 address by its /56', () => {
		const key = (address: string) => clientAddressKey({ ip: '127.0.0.1', headers: { 'x-azure-clientip': address } });
		assert.strictEqual(key('2001:db8:1234:5600::1'), key('2001:db8:1234:56ff::9'));
		assert.notStrictEqual(key('2001:db8:1234:5600::1'), key('2001:db8:1234:5700::1'));
	});
});
