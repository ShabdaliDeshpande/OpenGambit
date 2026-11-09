import { describe, expect, it } from 'vitest';
import { apiUrl, authHeaders, isNativeApp, normaliseServer, serverBase, socketProtocols } from './server';

describe('server address', () => {
  it('turns what the player typed into an https origin', () => {
    expect(normaliseServer('chess.example.com')).toBe('https://chess.example.com');
    expect(normaliseServer('  https://chess.example.com/play?x=1  ')).toBe('https://chess.example.com');
    expect(normaliseServer('https://chess.example.com:8443/')).toBe('https://chess.example.com:8443');
    expect(normaliseServer('HTTPS://Chess.Example.com')).toBe('https://chess.example.com');
    expect(normaliseServer('opengambit.onrender.com/')).toBe('https://opengambit.onrender.com');
  });

  it('refuses anything that is not an https server', () => {
    for (const bad of ['', '   ', 'http://chess.example.com', 'ftp://chess.example.com', 'javascript:alert(1)', 'https://user:pw@chess.example.com', 'https://', 'not a url at all'])
      expect(normaliseServer(bad)).toBeNull();
  });

  it('leaves the website on its own address, with cookies', () => {
    expect(isNativeApp).toBe(false);
    expect(serverBase()).toBe('');
    expect(apiUrl('/api/me')).toBe('/api/me');
    expect(authHeaders()).toEqual({});
    expect(socketProtocols()).toBeUndefined();
  });
});
