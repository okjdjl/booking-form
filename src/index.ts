import 'dotenv/config';
import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string
);

const SHARED_SECRET = process.env.SHARED_SECRET || 'dev-secret-change-me';

// Define the shape of an incoming booking request
interface BookingRequestBody {
  name: string;
  email: string;
  date: string; // DD/MM/YYYY from the Google Form
}

// Define the shape of a row as stored in Supabase
interface Booking {
  id: string;
  name: string;
  email: string;
  requested_date: string;
  status: string;
  slack_notified: boolean;
  created_at: string;
}

interface HealthSummary {
  status: 'ok' | 'degraded';
  lastBooking: Booking | null;
  totalBookingsToday: number;
  lastSlackNotificationSucceeded: boolean | null;
}

app.post('/bookings', async (req: Request<{}, {}, BookingRequestBody>, res: Response) => {
  const authHeader = req.headers['x-api-key'];
  if (authHeader !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, email, date } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const [day, month, year] = date.split('/');
  const isoDate = `${year}-${month}-${day}`;

  const { data, error } = await supabase
    .from('bookings')
    .insert([{ name, email, requested_date: isoDate }])
    .select();

  if (error) {
    if (error.code === '23505') {
      console.log('Duplicate booking ignored:', { email, isoDate });
      return res.status(200).json({ status: 'duplicate_ignored' });
    }
    console.error('Insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  const booking = data[0] as Booking;
  console.log('Booking inserted:', booking);

  try {
    const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📅 New booking: *${name}* (${email}) — requested ${isoDate}`
      })
    });

    if (slackResponse.ok) {
      await supabase.from('bookings').update({ slack_notified: true }).eq('id', booking.id);
    } else {
      console.error('Slack notification failed with status:', slackResponse.status);
    }
  } catch (slackError) {
    console.error('Slack notification error:', (slackError as Error).message);
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

  const todayCount = recentBookings.filter(
    (b: Booking) => new Date(b.created_at) >= startOfDay
  ).length;

  const lastBooking = recentBookings[0] ?? null;

  const summary: HealthSummary = {
    status: 'ok',
    lastBooking,
    totalBookingsToday: todayCount,
    lastSlackNotificationSucceeded: lastBooking ? lastBooking.slack_notified : null
  };

  res.status(200).json(summary);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Booking API running on port ${PORT}`));