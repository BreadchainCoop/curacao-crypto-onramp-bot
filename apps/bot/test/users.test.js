const test = require('node:test');
const assert = require('node:assert/strict');
const { createUsersService } = require('../services/users');

// Minimal mock of the Supabase client surface used by the users service.
function mockClient(existingWallet) {
  const inserts = [];
  const upserts = [];
  let current = existingWallet ? { wallet_address: existingWallet } : null;
  const client = {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current, error: null }) }) }),
        insert: async (row) => {
          inserts.push(row);
          return { error: null };
        },
        upsert: async (row) => {
          upserts.push(row);
          current = { wallet_address: row.wallet_address };
          return { error: null };
        },
      };
    },
  };
  return { client, inserts, upserts };
}

test('saveWallet logs old -> new to history when the address changes', async () => {
  const { client, inserts, upserts } = mockClient('0xOLD');
  await createUsersService({ client }).saveWallet(7, '0xNEW');
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0], { telegram_id: 7, old_address: '0xOLD', new_address: '0xNEW' });
  assert.equal(upserts[0].wallet_address, '0xNEW');
});

test('saveWallet does not log history on first save (no old address)', async () => {
  const { client, inserts } = mockClient(null);
  await createUsersService({ client }).saveWallet(7, '0xFIRST');
  assert.equal(inserts.length, 0);
});

test('saveWallet does not log history when the address is unchanged', async () => {
  const { client, inserts } = mockClient('0xSAME');
  await createUsersService({ client }).saveWallet(7, '0xSAME');
  assert.equal(inserts.length, 0);
});
