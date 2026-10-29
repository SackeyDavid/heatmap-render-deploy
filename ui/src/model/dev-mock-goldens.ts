import g01 from '../../../fixtures/model/golden/g01-faq-open.json';
import g16 from '../../../fixtures/model/golden/g16-scroll-halfway.json';
import m06 from '../../../fixtures/model/golden/m06-vehicle-picker.json';

/** Canned mock answers for local Track 2 (Model Lab + `VITE_MERCHANT_MODEL=mock`). */
export const DEV_MOCK_GOLDENS: Record<string, { rawText: string }> = {
  'tell me when someone opens a faq.': g01,
  'fire when a visitor scrolls halfway down the page.': g16,
  'let me know each time someone gets going with the vehicle picker': m06,
};
