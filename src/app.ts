import 'dotenv/config';
import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

export const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string
);

const SHARED_SECRET = process.env.SHARED_SECRET || 'dev-secret-change-me';

interface BookingRequestBody {
  name: string;
  email: string;
  date: string;
}

interface Booking {
  id: string;
  name: string;
  email: string;
  requested_date: string;
  status: string;
  slack_notified: boolean;
  created_at: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/bookings', async (req: Request<{}, {}, BookingRequestBody>, res: Response) => {
  const authHeader = req.headers['x-api-key'];
  if (authHeader !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, email, date } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const [day, month, year] = date.split('/');
  const isoDate = `${year}-${month}-${day}`;

  const { data, error } = await supabase
    .from('bookings')
    .insert([{ name, email, requested_date: isoDate }])
    .select();

  if (error) {
    if (error.code === '23505') {
      return res.status(200).json({ status: 'duplicate_ignored' });
    }
    console.error('Insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  const booking = data[0] as Booking;

  let slackSucceeded = false;
  try {
    const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `📅 New booking: *${name}* (${email}) — requested ${isoDate}` })
    });
    slackSucceeded = slackResponse.ok;
    if (!slackResponse.ok) {
      console.error('Slack notification failed with status:', slackResponse.status);
    }
  } catch (slackError) {
    console.error('Slack notification error:', (slackError as Error).message);
  }

  // Separate try/catch: an update failure here is a Supabase problem, not a Slack problem —
  // keeping it isolated means the error log always points at the right system.
  if (slackSucceeded) {
    try {
      await supabase.from('bookings').update({ slack_notified: true }).eq('id', booking.id);
    } catch (updateError) {
      console.error('Failed to update slack_notified flag:', (updateError as Error).message);
    }
  }

  res.status(200).json({ status: 'ok', booking });
});

app.get('/health', async (req: Request, res: Response) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: recentBookings, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !recentBookings) {
    return res.status(500).json({ status: 'degraded', error: 'Could not reach database' });
  }

  const todayCount = recentBookings.filter((b: Booking) => new Date(b.created_at) >= startOfDay).length;
  const lastBooking = recentBookings[0] ?? null;

  res.status(200).json({
    status: 'ok',
    lastBooking,
    totalBookingsToday: todayCount,
    lastSlackNotificationSucceeded: lastBooking ? lastBooking.slack_notified : null
  });
});