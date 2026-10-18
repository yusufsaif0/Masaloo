import { daySchema } from './finance-validation.js';

const devanagari = value => value.replace(/[०-९]/g, digit => String('०१२३४५६७८९'.indexOf(digit)));
export function parseBillText(rawText, confidence = 0) {
  const text = String(rawText || '').slice(0, 20000);
  const lines = devanagari(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const totals = [];
  for (const line of lines) {
    // A labelled total is safer than choosing the largest number (GSTINs, phones, quantities).
    if (!/grand\s*total|net\s*(?:total|amount)|amount\s*(?:payable|due)|total\s*(?:amount|payable)?|कुल|योग|देय/i.test(line)
      || /sub\s*total|subtotal|tax\s*total|कुल\s*कर/i.test(line)) continue;
    const matches = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/gi)];
    if (!matches.length) continue;
    const value = Number(matches.at(-1)[1].replaceAll(',', ''));
    if (value > 0 && value <= 1000000000) totals.push({ value, priority: /grand|net|payable|देय/i.test(line) ? 2 : 1 });
  }
  const ranked = totals.sort((a, b) => b.priority - a.priority);
  const candidateTotals = [...new Set(ranked.map(item => item.value))];
  let date = '';
  for (const line of lines.filter(line => /date|दिनांक|तारीख/i.test(line))) {
    const match = line.match(/\b(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!match) continue;
    let [, a, b, c] = match;
    if (a.length === 4) date = `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    else { if (c.length === 2) c = '20' + c; date = `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`; }
    if (daySchema.safeParse(date).success) break;
    date = '';
  }
  const numberLine = lines.find(line => /(?:invoice|bill|receipt)\s*(?:no\.?|number|#)|बिल\s*(?:नं|संख्या)/i.test(line));
  const billNumber = numberLine?.match(/(?:no\.?|number|#|नं\.?|संख्या)\s*[:.-]?\s*([\w/-]+)/i)?.[1] || '';
  const warnings = [];
  if (confidence < 75) warnings.push('The image may be unclear. Check every field against the bill.');
  if (!candidateTotals.length) warnings.push('No reliable labelled total was found. Enter the amount manually.');
  if (candidateTotals.length > 1) warnings.push('Different totals were detected. Confirm the final amount.');
  if (!date) warnings.push('Bill date was not recognised. Choose it manually.');
  return { text, confidence: Math.max(0, Math.min(100, Number(confidence) || 0)), warnings,
    suggestions: { payeeName: (lines[0] || '').slice(0, 150), billNumber, date, total: ranked[0]?.value ?? '' }, candidateTotals };
}
