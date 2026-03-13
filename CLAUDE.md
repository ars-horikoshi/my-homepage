# My Homepage - Claude Code Guide

## Playwright E2E Testing

This project uses [Playwright](https://playwright.dev/) for E2E and exploratory testing.

### Setup
```bash
npm install
npx playwright install chromium
```

### Running Tests

```bash
# Run all E2E tests (requires local dev server on port 8788)
npm run test:e2e

# Run with visual UI (interactive mode for debugging)
npm run test:e2e:ui

# Run unit tests
npm test

# Run unit tests with coverage
npm run test:coverage
```

### Exploratory Testing with Codegen

Claude Code can use `playwright codegen` to explore the app and discover bugs:

```bash
# Record interactions on local dev server
npx playwright codegen http://localhost:8788

# Record interactions on production
npx playwright codegen https://my-homepage-16e.pages.dev
```

### Using Playwright CLI for AI Bug Discovery

Claude Code should follow this workflow for exploratory testing:

1. **Start local dev server** (if not running):
   ```bash
   cd ~/projects/my-homepage && python server.py &
   ```

2. **Run existing tests first** to establish baseline:
   ```bash
   npm run test:e2e
   ```

3. **Explore app systematically** using playwright's page.goto, page.click, page.fill:
   - Navigate all views (weekly, monthly)
   - Navigate prev/next weeks and months
   - Add/edit/delete events via the form modal
   - Toggle dark mode
   - Test responsive behavior at different viewport sizes

4. **Key areas to probe for bugs**:
   - Time line position accuracy in weekly view
   - Event overlap layout (multiple simultaneous events)
   - Japanese holiday display (祝日ライン)
   - Month boundary behavior (days from prev/next month shown in monthly view)
   - Form validation (empty title, invalid dates)
   - GCal auth flow (unauthenticated → auth button appears)

5. **Run screenshot comparison** to detect visual regressions:
   ```bash
   npx playwright test --update-snapshots  # update baselines
   npx playwright test                     # compare against baselines
   ```

### Unit Tests

Unit tests cover all pure functions in `src/utils.js` and all API handlers in `functions/api/`.

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

## Local Development

```bash
# Start dev server (Python + KV simulation)
cd ~/projects/my-homepage
source venv/bin/activate  # if using venv
python server.py

# Or with wrangler (Cloudflare local)
wrangler pages dev public --kv=SCHEDULE_KV
```

## Deployment

```bash
bash build.sh && wrangler pages deploy public --project-name=my-homepage --branch=main --commit-dirty=true
```
