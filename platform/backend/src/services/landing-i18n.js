// Interface words of our own landing template, by geo. Only labels: no claims about the product,
// no timers, no stock counts — everything factual comes from the scraped product.
const T = {
  fr: { buy: 'Commander', choose: 'Choisissez votre offre', reviews: 'Avis clients', specs: 'Caractéristiques', description: 'Description', pieces: 'pc', save: 'Économisez', delivery: 'Paiement à la livraison', rating: 'Note', of: 'sur', no_reviews: '' },
  de: { buy: 'Jetzt bestellen', choose: 'Wählen Sie Ihr Angebot', reviews: 'Kundenbewertungen', specs: 'Eigenschaften', description: 'Beschreibung', pieces: 'Stk', save: 'Sie sparen', delivery: 'Zahlung bei Lieferung', rating: 'Bewertung', of: 'von', no_reviews: '' },
  es: { buy: 'Pedir ahora', choose: 'Elige tu oferta', reviews: 'Opiniones de clientes', specs: 'Características', description: 'Descripción', pieces: 'ud', save: 'Ahorras', delivery: 'Pago contra reembolso', rating: 'Valoración', of: 'de', no_reviews: '' },
  it: { buy: 'Ordina ora', choose: 'Scegli la tua offerta', reviews: 'Recensioni dei clienti', specs: 'Caratteristiche', description: 'Descrizione', pieces: 'pz', save: 'Risparmi', delivery: 'Pagamento alla consegna', rating: 'Valutazione', of: 'su', no_reviews: '' },
  nl: { buy: 'Nu bestellen', choose: 'Kies je aanbieding', reviews: 'Klantbeoordelingen', specs: 'Kenmerken', description: 'Beschrijving', pieces: 'st', save: 'Je bespaart', delivery: 'Betalen bij levering', rating: 'Beoordeling', of: 'van', no_reviews: '' },
  pt: { buy: 'Encomendar', choose: 'Escolha a sua oferta', reviews: 'Opiniões de clientes', specs: 'Características', description: 'Descrição', pieces: 'un', save: 'Poupa', delivery: 'Pagamento na entrega', rating: 'Avaliação', of: 'de', no_reviews: '' },
  pl: { buy: 'Zamów teraz', choose: 'Wybierz ofertę', reviews: 'Opinie klientów', specs: 'Cechy', description: 'Opis', pieces: 'szt', save: 'Oszczędzasz', delivery: 'Płatność przy odbiorze', rating: 'Ocena', of: 'na', no_reviews: '' },
  en: { buy: 'Order now', choose: 'Choose your offer', reviews: 'Customer reviews', specs: 'Specifications', description: 'Description', pieces: 'pcs', save: 'You save', delivery: 'Cash on delivery', rating: 'Rating', of: 'of', no_reviews: '' },
};

// Geo → language of the page.
export const GEO_LANG = { FR: 'fr', BE: 'fr', CH: 'fr', LU: 'fr', CA: 'fr', DE: 'de', AT: 'de', ES: 'es', CL: 'es', CO: 'es', IT: 'it', NL: 'nl', PT: 'pt', PL: 'pl', IE: 'en', GB: 'en', UK: 'en' };
export const OWN_GEOS = ['FR', 'BE', 'CH', 'LU', 'DE', 'AT', 'ES', 'IT', 'NL', 'PT', 'PL', 'IE'];

export function langOf(geo) { return GEO_LANG[String(geo || '').toUpperCase()] || 'en'; }
export function words(geo) { return T[langOf(geo)] || T.en; }
