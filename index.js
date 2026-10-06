require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SHARED_SECRET = process.env.SHARED_SECRET || 'dev-secret-change-me';

app.post('/bookings', async (req, res) => {
  const authHeader = req.headers['x-api-key'];
  if (authHeader !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, email, date } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Convert "05/10/2026" (DD/MM/YYYY from your form) into an ISO date Postgres expects (YYYY-MM-DD)
  const [day, month, year] = date.split('/');
  const isoDate = `${year}-${month}-${day}`;

  const { data, error } = await supabase
    .from('bookings')
    .insert([{ name, email, requested_date: isoDate }])
    .select();

  if (error) {
    // Postgres unique constraint violation has code 23505
    if (error.code === '23505') {
      console.log('Duplicate booking ignored:', { email, isoDate });
      return res.status(200).json({ status: 'duplicate_ignored' });
    }
    console.error('Insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  console.log('Booking inserted:', data[0]);
   // Fire Slack notification — but don't let a Slack failure break the booking response
  try {
    const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📅 New booking: *${name}* (${email}) — requested ${isoDate}`
      })
    });

    if (slackResponse.ok) {
      // Mark the row as notified now that Slack confirmed receipt
      await supabase.from('bookings').update({ slack_notified: true }).eq('id', data[0].id);
    } else {
      console.error('Slack notification failed with status:', slackResponse.status);
    }

  } catch (slackError) {
    console.error('Slack notification error:', slackError.message);
  }

  res.status(200).json({ status: 'ok', booking: data[0] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Booking API running on port ${PORT}`));
