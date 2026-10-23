import { describe, expect, it } from 'vitest';
import { htmlText } from '../../pipeline/html-text.ts';
import { chunkSections } from '../../search/chunk.ts';

// A saved order confirmation, much as a shop's page or a mailed receipt is built.
const RECEIPT = `<!doctype html>
<html>
<head>
  <title>Your order</title>
  <style>p { color: red }</style>
  <script>window.track('order viewed')</script>
</head>
<body>
  <span style="display: none; max-height: 0">Your kettle ships soon! Click to see more.</span>
  <div hidden>Tracking pixel fallback</div>
  <img src="logo.png" alt="">
  <h1>Order <b>1234</b></h1>
  <h2>Items</h2>
  <table>
    <tr><th>Item</th><th>Price</th></tr>
    <tr><td>Kettle</td><td>$29.99</td></tr>
  </table>
  <h2>Shipping</h2>
  <p>To 1 Main St,<br>Springfield</p>
  <noscript>Turn on JavaScript</noscript>
</body>
</html>`;

describe('htmlText', () => {
  it('keeps what the page says and none of its markup, script, style or what it hides', () => {
    const text = htmlText(RECEIPT);

    expect(text).toBe(
      ['# Order 1234', '## Items', 'Item Price', 'Kettle $29.99', '## Shipping', 'To 1 Main St,\nSpringfield'].join(
        '\n\n',
      ),
    );
    expect(text).not.toMatch(/track|color|ships soon|Tracking|JavaScript|Your order/);
  });

  it('writes its headings at their depth, so search knows where a passage sits', () => {
    expect(chunkSections(htmlText(RECEIPT), 1000)).toEqual([
      { heading: 'Order 1234 › Items', content: 'Item Price\n\nKettle $29.99' },
      { heading: 'Order 1234 › Shipping', content: 'To 1 Main St, Springfield' },
    ]);
  });

  it('starts no section at a heading with no words, and reads a page with no headings at all', () => {
    expect(htmlText('<h1><img src="logo.png"></h1><p>Thanks for shopping.</p>')).toBe('Thanks for shopping.');
    expect(htmlText('<p>One.</p><p>Two.</p>')).toBe('One.\n\nTwo.');
  });

  it('reads a page that is not well-formed', () => {
    expect(htmlText('<p>Total: <b>$5<p>Paid')).toBe('Total: $5\n\nPaid');
  });
});
