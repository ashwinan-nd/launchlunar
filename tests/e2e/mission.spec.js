import { test, expect } from '@playwright/test';

// End-to-end mission flow. The app exposes window.__lunar for programmatic
// state inspection (see src/main.js).

async function waitForData(page) {
  // Data pipeline is done when the object count is nonzero
  await page.waitForFunction(
    () => window.__lunar && window.__lunar.state.totalObjects > 0,
    null,
    { timeout: 180_000 }
  );
}

async function runLaunchFlow(page) {
  await page.click('.preset-btn'); // Apollo 11
  await page.click('#launch-btn');
  await page.waitForSelector('.window-card', { timeout: 120_000 });
}

test('boots, loads data, and renders the scene', async ({ page }) => {
  await page.goto('/');
  await waitForData(page);

  const counts = await page.evaluate(() => ({
    total: window.__lunar.state.totalObjects,
    hasScene: !!window.__lunar.state.scene,
  }));
  expect(counts.total).toBeGreaterThan(1000); // real Space-Track catalog (~31k) or live fallback
  expect(counts.hasScene).toBe(true);
});

test('full mission: preset -> launch -> varied windows -> playback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop-flow test; mobile has its own flow test');
  await page.goto('/');
  await waitForData(page);
  await runLaunchFlow(page);

  // Five windows on distinct days with capture results
  const windows = await page.evaluate(() =>
    window.__lunar.state.launchWindows.map((w) => ({
      date: w.launchDate.toISOString(),
      result: w.trajectory.transferResult,
      dv: w.deltaV.total,
      flightDays: w.flightDuration / 86400,
    }))
  );
  expect(windows.length).toBe(5);
  for (const w of windows) {
    expect(w.result).toBe('capture');
    expect(w.flightDays).toBeGreaterThan(2);
    expect(w.flightDays).toBeLessThan(7.9);
    expect(new Date(w.date).getTime()).toBeGreaterThan(Date.now() - 60_000);
  }
  const days = new Set(windows.map((w) => w.date.slice(0, 10)));
  expect(days.size).toBeGreaterThanOrEqual(3);

  // Launch beacon coincides with the trajectory START. (The Earth spin is
  // frozen at the launch epoch's GMST during a mission, so the beacon lives in
  // scene space at the true ECI launch point — the trajectory's first
  // waypoint. That coincidence is the invariant that matters.)
  const markerErr = await page.evaluate(() => {
    const { state } = window.__lunar;
    const scene = state.scene;
    const marker =
      scene.scene.getObjectByName('launchSite') ||
      (scene.earth && scene.earth.getObjectByName('launchSite'));
    if (!marker || !state.trajectoryPoints) return -1;
    const V = scene.camera.position.constructor;
    const wp = new V();
    marker.children[0].getWorldPosition(wp);
    const t0 = state.trajectoryPoints[0];
    return Math.hypot(wp.x - t0.x, wp.y - t0.y, wp.z - t0.z);
  });
  expect(markerErr).toBeGreaterThanOrEqual(0);
  expect(markerErr).toBeLessThan(1e-2);

  // Scrub through the mission: phases progress in order, rocket radius grows
  const seq = await page.evaluate(async () => {
    const scrub = document.getElementById('timeline-scrubber');
    const out = [];
    for (const v of [50, 200, 280, 500, 800, 990]) {
      scrub.value = String(v);
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const rp = window.__lunar.state.rocketMesh.position;
      out.push({
        v,
        phase: document.getElementById('phase-status').textContent,
        r: Math.hypot(rp.x, rp.y, rp.z),
      });
    }
    return out;
  });
  expect(seq[0].phase).toMatch(/launch/i);
  expect(seq[0].r).toBeLessThan(1.1);
  expect(seq[seq.length - 1].phase).toMatch(/landing/i);
  expect(seq[seq.length - 1].r).toBeGreaterThan(40);

  // Playback runs: progress advances over a real second of play
  const progressed = await page.evaluate(async () => {
    const scrub = document.getElementById('timeline-scrubber');
    scrub.value = '0';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('play-btn').click();
    const p0 = window.__lunar.state.playProgress;
    await new Promise((r) => setTimeout(r, 1200));
    const p1 = window.__lunar.state.playProgress;
    document.getElementById('play-btn').click(); // pause
    return p1 - p0;
  });
  expect(progressed).toBeGreaterThan(0.005);

  // Conjunction/risk highlighting API accepts edge cases without throwing
  // (the real-data branch exposes showConjunctionMarkers; overhaul added
  // setRiskObjects — accept whichever the consolidated build carries).
  const riskOk = await page.evaluate(() => {
    const scene = window.__lunar.state.scene;
    try {
      if (typeof scene.setRiskObjects === 'function') {
        scene.setRiskObjects(['nonexistent-id', 'nonexistent-id']);
        scene.setRiskObjects(new Map([['also-missing', 2.5]]));
        scene.setRiskObjects([]);
      }
      if (typeof scene.setRiskHighlightEnabled === 'function') {
        scene.setRiskHighlightEnabled(false);
        scene.setRiskHighlightEnabled(true);
      }
      if (typeof scene.clearConjunctionMarkers === 'function') {
        scene.clearConjunctionMarkers();
      }
      return true;
    } catch (e) {
      return String(e);
    }
  });
  expect(riskOk).toBe(true);

  // View buttons frame Earth and Moon. The TRAJECTORY overview is a 2.0 s gsap
  // camera tween; poll until it settles (headless load can start it late).
  await page.click('#view-trajectory-btn');
  const framing = () => page.evaluate(() => {
    const scene = window.__lunar.state.scene;
    const cam = scene.camera;
    const moon = scene.moon.position;
    const fwd = new (cam.position.constructor)();
    cam.getWorldDirection(fwd);
    const toEarth = cam.position.clone().negate().normalize();
    const toMoon = moon.clone().sub(cam.position).normalize();
    const vFov = (cam.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const halfDiag = Math.min(vFov, hFov) / 2 + 0.35; // margin
    return {
      earthAngle: Math.acos(Math.max(-1, Math.min(1, fwd.dot(toEarth)))),
      moonAngle: Math.acos(Math.max(-1, Math.min(1, fwd.dot(toMoon)))),
      limit: halfDiag,
    };
  });
  let trajectoryFraming = await framing();
  for (let i = 0; i < 20 && (trajectoryFraming.earthAngle >= trajectoryFraming.limit || trajectoryFraming.moonAngle >= trajectoryFraming.limit); i++) {
    await page.waitForTimeout(400);
    trajectoryFraming = await framing();
  }
  expect(trajectoryFraming.earthAngle).toBeLessThan(trajectoryFraming.limit);
  expect(trajectoryFraming.moonAngle).toBeLessThan(trajectoryFraming.limit);
});

test('form validation rejects garbage and custom coordinates work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop-flow test; form is behind the drawer on mobile');
  await page.goto('/');
  await waitForData(page);

  // Missing fields -> error message, no crash
  await page.click('#launch-btn');
  await expect(page.locator('#form-error')).not.toHaveText('');

  // Custom coordinates flow (equatorial Guiana Space Centre)
  await page.click('.preset-btn');
  await page.selectOption('#f-launch-site', 'Custom');
  await page.locator('#f-custom-lat').waitFor({ state: 'visible', timeout: 10_000 });
  await page.fill('#f-custom-lat', '5.2360');
  await page.fill('#f-custom-lon', '-52.7686');
  // Ensure the values registered before launching.
  await expect(page.locator('#f-custom-lat')).toHaveValue('5.2360');
  await page.click('#launch-btn');
  await page.waitForSelector('.window-card', { timeout: 180_000 });
  const n = await page.locator('.window-card').count();
  expect(n).toBeGreaterThan(0);
});

test('mobile: drawer collapsed by default, launch flow completes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile project only');

  await page.goto('/');
  await waitForData(page);

  // Sidebar starts collapsed to a rail; the 3D canvas is visible
  const collapsed = await page.evaluate(() =>
    document.getElementById('left-sidebar').classList.contains('collapsed')
  );
  expect(collapsed).toBe(true);

  // Expand via the rocket rail, run the flow
  await page.click('#sidebar-rocket-icon');
  await page.click('.preset-btn');
  await page.click('#launch-btn');
  await page.waitForSelector('.window-card', { timeout: 120_000 });

  // Bottom-sheet results are visible
  const sheetVisible = await page.evaluate(() => {
    const el = document.querySelector('.right-sidebar');
    return el.classList.contains('visible');
  });
  expect(sheetVisible).toBe(true);
});
