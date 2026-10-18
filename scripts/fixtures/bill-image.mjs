import sharp from 'sharp';
export async function billImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="780"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="44"><text x="70" y="90">MASALOO SUPPLIER</text><text x="70" y="190">Invoice No: BILL-17</text><text x="70" y="280">Date: 01/10/2026</text><text x="70" y="390">Subtotal: 1000.00</text><text x="70" y="480">GST: 50.00</text><text x="70" y="620">GRAND TOTAL: INR 1050.00</text></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
