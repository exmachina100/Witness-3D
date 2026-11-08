import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, TERM_COUNT, table, translate } from '../src/app/i18n.js';

test("Plasticity's languages, each with every term", () => {
    assert.deepEqual(LANGUAGES, ['en', 'de', 'es', 'it', 'ja', 'ru', 'zh', 'zh-tw']);
    assert.equal(table('en'), null);
    for (const lang of LANGUAGES.slice(1)) {
        const t = table(lang);
        assert.equal(t.size, TERM_COUNT, lang);
        for (const [en, v] of t) assert.ok(typeof v === 'string' && v.length, `${lang} ${en}`);
    }
});

test('whole terms and parts between dots are translated; the rest stays', () => {
    assert.equal(translate('UNDO', 'de'), 'RÜCKGÄNGIG');
    assert.equal(translate(' CURVES ', 'ja'), ' カーブ ');
    assert.equal(translate('SELECT · F SEARCH', 'es'), 'SELECCIONAR · F BUSCAR');
    assert.equal(translate('B-01 · CURVES', 'zh'), 'B-01 · 曲线');
    assert.equal(translate('12 CURVES · 54.5 WIDE', 'de'), null);
    assert.equal(translate('▾ SOLIDS', 'it'), '▾ SOLIDI');
    assert.equal(translate('UNDO', 'en'), null);
    assert.equal(translate('', 'de'), null);
});
