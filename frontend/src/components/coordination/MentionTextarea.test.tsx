import { tokenizeBody } from './MentionTextarea';
import type { Mention } from '../../lib/coordination-types';

describe('tokenizeBody', () => {
  it('should tokenize a simple mention correctly', () => {
    const body = 'Hello @Russell Dale!';
    const mentions: Mention[] = [
      { id: '123', name: 'Russell Dale', kind: 'internal' },
    ];
    const result = tokenizeBody(body, mentions);
    expect(result).toBe('Hello @[Russell Dale](user:123:internal)!');
  });

  it('should tokenize multiple mentions of the same and different users', () => {
    const body = 'Hi @Russell Dale and @Jane Doe, please review.';
    const mentions: Mention[] = [
      { id: '123', name: 'Russell Dale', kind: 'internal' },
      { id: '456', name: 'Jane Doe', kind: 'partner' },
    ];
    const result = tokenizeBody(body, mentions);
    expect(result).toBe('Hi @[Russell Dale](user:123:internal) and @[Jane Doe](user:456:partner), please review.');
  });

  it('should escape special regex characters in names correctly', () => {
    const body = 'Hey @Russell (Google) Dale, is this okay?';
    const mentions: Mention[] = [
      { id: '123', name: 'Russell (Google) Dale', kind: 'internal' },
    ];
    const result = tokenizeBody(body, mentions);
    expect(result).toBe('Hey @[Russell (Google) Dale](user:123:internal), is this okay?');
  });

  it('should prioritize longer names to avoid partial prefix replacement', () => {
    const body = 'Hello @Russell Dale and @Russell.';
    const mentions: Mention[] = [
      { id: '789', name: 'Russell', kind: 'partner' },
      { id: '123', name: 'Russell Dale', kind: 'internal' },
    ];
    const result = tokenizeBody(body, mentions);
    expect(result).toBe('Hello @[Russell Dale](user:123:internal) and @[Russell](user:789:partner).');
  });

  it('should not match mentions that are parts of other words', () => {
    const body = 'Email me at russell@iowacenter.org or contact @Russell.';
    const mentions: Mention[] = [
      { id: '123', name: 'Russell', kind: 'internal' },
    ];
    const result = tokenizeBody(body, mentions);
    expect(result).toBe('Email me at russell@iowacenter.org or contact @[Russell](user:123:internal).');
  });
});
