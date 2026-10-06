import request from 'supertest';

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => Promise.resolve({
          data: [{
            id: 'test-id-123',
            name: 'Test User',
            email: 'test@test.com',
            requested_date: '2026-10-05',
            status: 'pending',
            slack_notified: false,
            created_at: new Date().toISOString()
          }],
          error: null
        })
      }),
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: null })
      })
    })
  })
}));

// Also mock global fetch so the Slack call in the test doesn't hit the real webhook
global.fetch = jest.fn(() =>
  Promise.resolve({ ok: true } as Response)
) as jest.Mock;


import { app } from './app';

describe('POST /bookings', () => {
  it('rejects requests without the correct API key', async () => {
    const res = await request(app)
      .post('/bookings')
      .send({ name: 'Test', email: 'test@test.com', date: '05/10/2026' });

    expect(res.status).toBe(401);
  });

  it('rejects requests missing required fields', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('x-api-key', process.env.SHARED_SECRET || 'dev-secret-change-me')
      .send({ name: 'Test' }); // missing email and date

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('x-api-key', process.env.SHARED_SECRET || 'dev-secret-change-me')
      .send({ name: 'Test', email: 'not-an-email', date: '05/10/2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });

  it('successfully creates a booking with valid data', async () => {
  const res = await request(app)
    .post('/bookings')
    .set('x-api-key', process.env.SHARED_SECRET || 'dev-secret-change-me')
    .send({ name: 'Test User', email: 'test@test.com', date: '05/10/2026' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
  expect(res.body.booking.email).toBe('test@test.com');
});

});