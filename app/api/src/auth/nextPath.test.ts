// auth/nextPath.test.ts
import { describe, expect, it } from 'vitest';
import { validateNextPath } from './nextPath';

describe('validateNextPath', () => {
  it('接受正常站內路徑', () => {
    expect(validateNextPath('/p/abc/manage')).toBe('/p/abc/manage');
  });
  it('沒帶值時退回預設頁', () => {
    expect(validateNextPath(undefined)).toBe('/dashboard');
    expect(validateNextPath(null)).toBe('/dashboard');
    expect(validateNextPath('')).toBe('/dashboard');
  });
  it('拒絕不是 / 開頭的值', () => {
    expect(validateNextPath('https://evil.example/')).toBe('/dashboard');
  });
  it('拒絕 // 開頭（協議相對網址，開放重導向）', () => {
    expect(validateNextPath('//evil.example/')).toBe('/dashboard');
  });
  it('拒絕含反斜線', () => {
    expect(validateNextPath('/p\\evil')).toBe('/dashboard');
  });
  it('拒絕含換行', () => {
    expect(validateNextPath('/p/abc\r\nSet-Cookie: x')).toBe('/dashboard');
  });
});
