// fal.ai does not return the cost of a request in its response, so cost is computed from the official price list.
// Prices checked 2026-10-31 on the model pages (https://fal.ai/models/<model id>):
//   fal-ai/ideogram/v2, fal-ai/ideogram/v2/remix — "Your request will cost $0.08 per image."
//   fal-ai/flux/dev — "Your request will cost $0.025 per megapixel", "rounding up to the nearest megapixel".
// Billing rules (https://fal.ai/docs/model-apis/pricing): "You pay only for successful outputs", so a failed
// request costs 0. A model missing here has no known price: its cost is null (not measured), never 0.
// Override per model with FAL_PRICE_USD_<MODEL>, e.g. FAL_PRICE_USD_FAL_AI_IDEOGRAM_V2=0.08.
const PRICES = {
  'fal-ai/ideogram/v2': { unit: 'image', usd: 0.08 },
  'fal-ai/ideogram/v2/remix': { unit: 'image', usd: 0.08 },
  'fal-ai/flux/dev': { unit: 'megapixel', usd: 0.025 },
};

export function falPrice(model) {
  const base = PRICES[model] || null;
  const raw = process.env[`FAL_PRICE_USD_${String(model).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`];
  if (raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
    return { unit: base?.unit || 'image', usd: Number(raw) };
  }
  return base;
}

// Cost of one successful output, or null when the price (or the size a per-megapixel price needs) is unknown.
export function falOutputCost(model, size) {
  const price = falPrice(model);
  if (!price) return null;
  if (price.unit === 'image') return price.usd;
  if (price.unit === 'megapixel' && size?.width && size?.height) {
    return Math.round(price.usd * Math.ceil((size.width * size.height) / 1e6) * 1e6) / 1e6;
  }
  return null;
}

// Total of a list of {ok, cost_usd} requests: null when any successful one is not measured.
export function totalCost(requests) {
  let sum = 0;
  for (const r of requests) {
    if (!r.ok) continue;
    if (r.cost_usd == null) return null;
    sum += r.cost_usd;
  }
  return Math.round(sum * 1e6) / 1e6;
}
