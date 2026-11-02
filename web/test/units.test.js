// Plasticity's length and mass units (src/units.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLength, parseLength, showMass, showVolume, toUnit } from '../src/units.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('typed values are in the chosen unit unless they say otherwise', () => {
    close(parseLength('12', 'mm'), 12);
    close(parseLength('12', 'cm'), 120);
    close(parseLength('2in', 'mm'), 50.8);
    close(parseLength('1 ft', 'm'), 304.8);
    close(parseLength('3"', 'mm'), 76.2);
    close(parseLength('-1.5', 'in'), -38.1);
});

test('they take arithmetic, as the manual\'s 5 + 2in = 10.08 cm', () => {
    close(toUnit(parseLength('5 + 2in', 'cm'), 'cm'), 10.08);
    close(parseLength('2 * 3', 'cm'), 60);
    close(parseLength('3in * 2', 'mm'), 152.4);
    close(parseLength('(10 - 4) / 2', 'mm'), 3);
    close(parseLength('10 − 2×3', 'mm'), 4);
});

test('anything else is not a value', () => {
    for (const t of ['', 'abc', '2 +', '(3', '2 parsecs', '1..2']) assert.equal(parseLength(t, 'mm'), undefined, t);
});

test('readouts show the unit', () => {
    assert.equal(formatLength(25.4, 'in'), '1');
    assert.equal(showVolume(1e6, 'cm'), '1000 CM³');
    assert.equal(showMass(2268, 'lb'), '5 LB');
    assert.equal(showMass(1500, 'kg'), '1.5 KG');
});
