import { chromium } from 'playwright';

// Extract EAA... tokens from AdsPower profile remark field
// Format: "email :: EAA[user_token] :: ... БМ1 EAA[bm_token];cabinet_id; БМ2 EAA[bm_token];cabinet_id;"
export function parseTokensFromRemark(remark) {
  if (!remark) return { userToken: null, bmTokens: [] };

  const parts = remark.split('::');
  const userToken = parts[1]?.trim().match(/^(EAA[A-Za-z0-9]+)$/)?.[1] || null;

  const bmTokens = [];
  const bmPattern = /БМ\d+\s+(EAA[A-Za-z0-9]+);(\d+)/g;
  let m;
  while ((m = bmPattern.exec(remark)) !== null) {
    bmTokens.push({ token: m[1], cabinetId: m[2] });
  }

  return { userToken, bmTokens };
}

// Get token for a specific cabinet (ad account)
export function getTokenForCabinet(remark, cabinetExternalId) {
  const { userToken, bmTokens } = parseTokensFromRemark(remark);
  const bm = bmTokens.find(b => b.cabinetId === cabinetExternalId);
  return bm?.token || userToken;
}

// Validate token via Graph API
export async function validateToken(token) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${token}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    if (data.error) return { valid: false, error: data.error.message };
    return { valid: true, id: data.id, name: data.name };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Extract fresh token from AdsPower browser via CDP
export async function extractTokenViaCDP(wsEndpoint) {
  const browser = await chromium.connectOverCDP(wsEndpoint);
  try {
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    const page = await context.newPage();

    // Navigate to FB and intercept the access token from API calls
    let capturedToken = null;

    page.on('request', req => {
      const auth = req.headers()['authorization'];
      if (auth?.startsWith('Bearer EAA')) {
        capturedToken = auth.slice(7);
      }
      const url = req.url();
      const match = url.match(/[?&]access_token=(EAA[A-Za-z0-9]+)/);
      if (match) capturedToken = match[1];
    });

    await page.goto('https://business.facebook.com/', { timeout: 20000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Try extracting from cookies if request interception didn't catch it
    if (!capturedToken) {
      const cookies = await context.cookies(['https://www.facebook.com']);
      const xs = cookies.find(c => c.name === 'xs')?.value;
      const cUser = cookies.find(c => c.name === 'c_user')?.value;
      if (xs && cUser) {
        // Use FBJS to get token
        capturedToken = await page.evaluate(async () => {
          try {
            const r = await fetch('/api/graphql/', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: 'doc_id=3734234566641876&variables={}',
            });
            const t = await r.text();
            const m = t.match(/"access_token":"(EAA[A-Za-z0-9]+)"/);
            return m?.[1] || null;
          } catch { return null; }
        });
      }
    }

    await page.close();
    return capturedToken;
  } finally {
    await browser.close();
  }
}
