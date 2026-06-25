// KYC flow — triggers Synaps verification and gates further actions on pass.
//
// #2: skeleton only — sends the user a (placeholder) verification link and marks
// the session pending. The real Synaps session + /webhook/kyc result lands in #8.

const { KycStatus } = require('../state/session');

async function startKyc(ctx) {
  const { kycStatus } = ctx.session;

  if (kycStatus === KycStatus.PENDING) {
    await ctx.reply(
      "⏳ Your identity check is still under review. We'll message you the moment it's approved."
    );
    return;
  }
  if (kycStatus === KycStatus.REJECTED) {
    await ctx.reply(
      '❌ Your previous verification was not approved. Please contact support to retry.'
    );
    return;
  }

  ctx.session.kycStatus = KycStatus.PENDING;
  // TODO(#8): create a Synaps verification session and send the real link.
  await ctx.reply(
    'Before you can buy, we need to verify your identity (one time only).\n\n' +
      '🔗 Verification link: _placeholder — Synaps integration in #8_\n\n' +
      'Once you are approved, send /buy again to continue.',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { startKyc };
