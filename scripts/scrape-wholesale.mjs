import { scrapeWholesaleCatalog } from '../server/wholesale-import.js';
const result = await scrapeWholesaleCatalog({ seedAssets: true, progress: name => console.log(`Saved: ${name}`) });
console.log(`Imported ${result.products.length} raw-spice references with local images. Wholesale prices are unset for owner review.`);
if (result.failures.length) console.log(JSON.stringify({ failures: result.failures }));
