// KYC flow — triggers Synaps verification and gates further actions on pass.
//
// With an injected `kyc` service, starts a real Synaps session (which persists
// the session id + sets the user pending) and sends the verification link. The
// /buy gate (resolveBuyGate) keeps the user out of payment until kyc_status is
// approved. The real /webhook/kyc result lands in the backend (#8).

const { KycStatus } = require('../state/session');

/**
 * @param {object} ctx
 * @param {{kyc?: {startVerification: (p: object) => Promise<{verificationUrl: string}>}}} [deps]
 */
async function startKyc(ctx, deps = {}) {
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

  if (deps.kyc) {
    try {
      const { verificationUrl } = await deps.kyc.startVerification({
        telegramId: ctx.from && ctx.from.id,
      });
      ctx.session.kycStatus = KycStatus.PENDING;
      await ctx.reply(
        'Before you can buy, we need to verify your identity (one time only).\n\n' +
          `🔗 Verify here: ${verificationUrl}\n\n` +
          'Once you are approved, send /buy again to continue.'
      );
    } catch (err) {
      await ctx.reply('Sorry — we could not start verification right now. Please try /buy again.');
    }
    return;
  }

  // No KYC service wired yet (Synaps keys pending — see #8).
  ctx.session.kycStatus = KycStatus.PENDING;
  await ctx.reply(
    'Before you can buy, we need to verify your identity (one time only).\n\n' +
      '🔗 Verification link: _pending Synaps configuration (#8)_\n\n' +
      'Once you are approved, send /buy again to continue.',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { startKyc };
