const test = require('node:test');
const assert = require('node:assert/strict');
const { initialSession, KycStatus } = require('../state/session');
const { startKyc } = require('../flows/kyc');

function mockCtx(session, fromId = 7) {
  const replies = [];
  return {
    session,
    from: { id: fromId },
    reply: async (t) => replies.push(String(t)),
    replies,
  };
}

test('with a kyc service, sends the verification link and marks pending', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  const kyc = {
    calls: [],
    startVerification: async (p) => {
      kyc.calls.push(p);
      return { verificationUrl: 'https://verify.test/?session_id=abc' };
    },
  };
  await startKyc(ctx, { kyc });

  assert.equal(kyc.calls.length, 1);
  assert.equal(kyc.calls[0].telegramId, 7);
  assert.equal(s.kycStatus, KycStatus.PENDING);
  assert.match(ctx.replies[0], /verify\.test/);
});

test('does not re-trigger when already pending', async () => {
  const s = initialSession();
  s.kycStatus = KycStatus.PENDING;
  const ctx = mockCtx(s);
  const kyc = { startVerification: async () => { throw new Error('should not be called'); } };
  await startKyc(ctx, { kyc });
  assert.match(ctx.replies[0], /under review/i);
});

test('falls back to a placeholder when no kyc service is wired', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  await startKyc(ctx);
  assert.equal(s.kycStatus, KycStatus.PENDING);
  assert.match(ctx.replies[0], /pending Synaps configuration/i);
});
