import test from 'node:test';
import assert from 'node:assert/strict';
import { xnurbsBoundary, XNURBS_LOOSE } from '../src/app/App.js';

test('XNURBS: Next and Adjacent need Quad sided; without it Adjacent acts as Normal', () => {
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: false, boundary: 'adjacent' }), 'normal');
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: false, boundary: 'next' }), 'natural');
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: true, boundary: 'adjacent' }), 'adjacent');
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: true, boundary: 'next' }), 'next');
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: false, boundary: 'normal' }), 'normal');
  assert.equal(xnurbsBoundary({ xnurbs: true, quad: false }), 'natural');
});

test('Square keeps every boundary whatever Quad sided says', () => {
  assert.equal(xnurbsBoundary({ xnurbs: false, quad: false, boundary: 'next' }), 'next');
  assert.equal(xnurbsBoundary({ xnurbs: false, quad: false, boundary: 'adjacent' }), 'adjacent');
});

test('Satisfy tolerances off loosens the fit as a Weight below 1 does', () => {
  assert.ok(XNURBS_LOOSE > 0.05 && XNURBS_LOOSE < 1);
});
