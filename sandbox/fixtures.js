(function (root) {
  'use strict';
  const fixtures = Object.freeze({
    visa: Object.freeze({ pan: '4242424242424242', method: 'pm_card_visa', label: 'Visa: success' }),
    mastercard: Object.freeze({ pan: '5555555555554444', method: 'pm_card_mastercard', label: 'Mastercard: success' }),
    declined: Object.freeze({ pan: '4000000000000002', method: 'pm_card_visa_chargeDeclined', label: 'Generic decline' }),
    insufficient_funds: Object.freeze({ pan: '4000000000009995', method: 'pm_card_visa_chargeDeclinedInsufficientFunds', label: 'Insufficient funds' })
  });
  function parseInput(raw) {
    if (typeof raw !== 'string' || raw.length > 32768) throw Error('Input must be text, at most 32 KiB.');
    const text = raw.trim();
    let rows = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter(s => s.trim());
    if (!Array.isArray(rows) || !rows.length || rows.length > 20) throw Error('Use 1–20 official test scenarios.');
    return rows.map((row, i) => {
      const value = typeof row === 'string' ? row : row?.scenario ?? row?.card;
      if (typeof value !== 'string') throw Error(`Row ${i + 1}: expected a scenario or test card.`);
      const name = value.trim();
      if (Object.hasOwn(fixtures, name)) return name;
      const pan = name.split('|')[0].replace(/[ -]/g, '');
      const entry = Object.entries(fixtures).find(([, fixture]) => fixture.pan === pan || fixture.method === name);
      if (!entry) throw Error(`Row ${i + 1}: not an official supported test scenario.`);
      // Expiry and CVC are not collected, stored or forwarded; Stripe test PMs encode the scenario.
      return entry[0];
    });
  }
  const api = Object.freeze({ fixtures, parseInput });
  if (typeof module !== 'undefined') module.exports = api;
  else root.SandboxFixtures = api;
})(globalThis);
