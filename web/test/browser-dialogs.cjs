const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    try {
        const page = await browser.newPage();
        await page.goto('http://127.0.0.1:4175/');
        await page.waitForFunction(() => window.__w3d?.bodies.length > 0);
        const appAction = action => page.evaluate(action => window.__w3d.doAction(action), action);
        const dialog = page.locator('[data-id="plane-dialog"]');
        const trigger = page.locator('[data-id="new-plane"]');
        await trigger.evaluate(button => {
            const section = button.closest('details');
            if (section) section.open = true;
        });
        await trigger.click();
        assert.equal(await dialog.evaluate(node => node.open && !node.matches(':modal')), true);
        await dialog.locator('[data-id="plane-pick-origin"]').click();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.evaluate(node => node.open), true);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.evaluate(node => node.open), false);
        assert.equal(await trigger.evaluate(node => node === document.activeElement), true);

        await page.evaluate(() => window.__w3d.startTool('export-mesh'));
        const mesh = page.locator('dialog[data-panel="export-mesh"]');
        assert.equal(await mesh.evaluate(node => node.matches(':modal')), true);
        await page.keyboard.press('Tab');
        assert.equal(await mesh.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press('Escape');
        assert.equal(await mesh.evaluate(node => node.open), false);

        const drawing = page.locator('dialog[data-panel="export-drawing"]');
        const openDrawing = () => page.evaluate(() => window.__w3d.startTool('export-drawing'));
        await openDrawing();
        assert.equal(await drawing.evaluate(node => node.matches(':modal')), true);
        const svg = drawing.locator('[data-drf="svg"]');
        const dxf = drawing.locator('[data-drf="dxf"]');
        const hiddenLines = drawing.locator('[data-id="dr-hidden"]');
        assert.equal(await svg.getAttribute('aria-pressed'), 'true');
        await dxf.click();
        await hiddenLines.click();
        assert.equal(await dxf.getAttribute('aria-pressed'), 'true');
        assert.equal(await svg.getAttribute('aria-pressed'), 'false');
        assert.equal(await hiddenLines.getAttribute('aria-pressed'), 'false');
        await drawing.locator('.xd-foot [data-xd="cancel"]').click();
        assert.equal(await drawing.evaluate(node => node.open), false);
        await openDrawing();
        assert.equal(await svg.getAttribute('aria-pressed'), 'true');
        assert.equal(await hiddenLines.getAttribute('aria-pressed'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await drawing.evaluate(node => node.open), false);

        await appAction('app:preferences');
        const prefs = page.locator('[data-id="prefs"]');
        assert.equal(await prefs.evaluate(node => node.matches(':modal')), true);
        await page.keyboard.press('Escape');
        assert.equal(await prefs.evaluate(node => node.open), false);
        console.log('Built preview mounted and New Plane, Mesh Export, Drawing Export, and Preferences dialog checks passed');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
