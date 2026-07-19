import { test, expect } from '@playwright/test';

// ── A small helper so we don't repeat the "log an exercise" steps in every test.
// Playwright gives each test a fresh browser (empty localStorage), so tests that
// need a logged exercise have to create one first.
async function logExercise(page, name, weight, reps = '5') {
  // Type into the exercise search box (its placeholder text, straight from the app)
  await page.getByPlaceholder('Start typing… e.g. Incline Dumbbell Press').fill(name);
  // Pick it from the autocomplete dropdown — this sets the name AND closes the dropdown
  await page.getByText(name, { exact: true }).click();
  // The first "—" placeholder is the reps box; the weight box's placeholder is "135"
  await page.getByPlaceholder('—').first().fill(reps);
  await page.getByPlaceholder('135').fill(weight);
  // Submit
  await page.getByRole('button', { name: 'Add to log' }).click();
}

// 1. Smoke test — the app loads and the main tabs are there.
test('app loads with the main tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Workouts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Milestones' })).toBeVisible();
});

// 2. Navigation — clicking a tab shows that tab's content.
test('Milestones tab shows lifetime stats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Milestones' }).click();
  await expect(page.getByText('Lifetime')).toBeVisible();
});

// 3. Core flow — logging an exercise makes it appear in the day.
test('logging an exercise adds it to the day', async ({ page }) => {
  await page.goto('/');
  await logExercise(page, 'Barbell Bench Press', '135');
  await expect(page.getByText('Barbell Bench Press')).toBeVisible();
});

// 4. Persistence — your data lives in localStorage, so it should survive a refresh.
test('logged data survives a page reload', async ({ page }) => {
  await page.goto('/');
  await logExercise(page, 'Barbell Bench Press', '135');
  await expect(page.getByText('Barbell Bench Press')).toBeVisible();

  await page.reload();                       // refresh the page
  await expect(page.getByText('Barbell Bench Press')).toBeVisible(); // still there
});

// 5. Feature — making a superset shows the grouped bracket with an A1 label.
test('creating a superset shows the grouped bracket', async ({ page }) => {
  await page.goto('/');
  await logExercise(page, 'Barbell Bench Press', '135');

  // The add-superset button is an icon button; its tooltip is its accessible name
  await page.getByTitle('Add a superset exercise').click();

  // The bracket header and the A1 marker should appear
  await expect(page.getByText('Superset')).toBeVisible();
  await expect(page.getByText('A1')).toBeVisible();
});