import { describe, expect, it } from 'vitest';
import { decodeText, textEncoding } from '../../pipeline/decode.ts';

/** The bytes a single-byte code page writes for this text. */
function encode(text: string, encoding: string): Uint8Array {
  const decoder = new TextDecoder(encoding);
  const byChar = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) {
    byChar.set(decoder.decode(Uint8Array.of(byte)), byte);
  }
  return Uint8Array.from([...text].map((char) => byChar.get(char) ?? 0x3f));
}

const GERMAN = 'Datum;Betrag;Empfänger\n03.04.2025;12,50;Bäckerei Müller\n04.04.2025;3,20;Straßenbahn';
const RUSSIAN = 'Дата;Сумма;Получатель\n03.04.2025;1250;Магазин продуктов на углу улицы';

describe('decodeText', () => {
  it('reads UTF-8 as UTF-8, and drops its byte-order mark', () => {
    expect(decodeText(new TextEncoder().encode(GERMAN))).toBe(GERMAN);
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Grüße')]))).toBe('Grüße');
  });

  it('reads UTF-16 by its byte-order mark, and without one', () => {
    const le = Buffer.from(`﻿${GERMAN}`, 'utf16le');
    expect(decodeText(le)).toBe(GERMAN);
    expect(decodeText(Buffer.from(GERMAN, 'utf16le'))).toBe(GERMAN);
    expect(decodeText(Buffer.from(RUSSIAN, 'utf16le').swap16())).toBe(RUSSIAN);
  });

  it('reads a Windows export in the code page it was written in', () => {
    expect(decodeText(encode(GERMAN, 'windows-1252'))).toBe(GERMAN);
    expect(decodeText(encode(RUSSIAN, 'windows-1251'))).toBe(RUSSIAN);
  });

  it('falls back to windows-1252 when there is nothing to guess from', () => {
    expect(decodeText(encode('£5', 'windows-1252'))).toBe('£5');
  });

  it("believes a page's <meta charset> once its bytes are not UTF-8", () => {
    const page = (meta: string) => encode(`<html><head>${meta}</head><body>Ваш заказ</body></html>`, 'windows-1251');
    expect(textEncoding(page('<meta charset="windows-1251">'), { html: true })).toBe('windows-1251');
    expect(
      textEncoding(page('<meta http-equiv="Content-Type" content="text/html; charset=koi8-r">'), { html: true }),
    ).toBe('koi8-r');
    // A declaration a page could not have written in ASCII, or no encoding at all, is passed over.
    expect(textEncoding(page('<meta charset="utf-16">'), { html: true })).not.toMatch(/utf-16/i);
    expect(textEncoding(page('<meta charset="nonsense">'), { html: true })).not.toBe('nonsense');
    // Not a page: a <meta> is just text.
    expect(textEncoding(page('<meta charset="koi8-r">'))).not.toBe('koi8-r');
  });

  it('keeps UTF-8 when an old <meta> says otherwise', () => {
    const page = new TextEncoder().encode('<meta charset="iso-8859-1"><p>Grüße</p>');
    expect(decodeText(page, { html: true })).toBe('<meta charset="iso-8859-1"><p>Grüße</p>');
  });
});
