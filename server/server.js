import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const dataPath = process.env.DB_PATH ? resolve(process.env.DB_PATH) : join(here, 'db.json');
const clientBuildPath = resolve(here, '../dist');
const port = Number(process.env.PORT || 4000);
const reservationConfirmationDelayMs = 3 * 60 * 1000;
const confirmationEmailRetryDelayMs = 60 * 1000;
const maxConfirmationEmailAttempts = 3;
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
];
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});
const adminSessions = new Set();
const creatorSessions = new Set();
const reservationConfirmationTimers = new Map();
const emailPattern = /^\S+@\S+\.\S+$/;

function seedEvents() {
  const nextFriday = new Date();
  nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
  nextFriday.setHours(20, 0, 0, 0);
  const sunday = new Date(nextFriday);
  sunday.setDate(sunday.getDate() + 2);
  const date = (value) => value.toISOString().slice(0, 10);
  return [
    { id: randomUUID(), title: 'Jazz au Zinc', description: 'Un trio de jazz en live, des bougies et les grands classiques de la maison.', date: date(nextFriday), time: '20:00', category: 'Musique', capacity: 48, booked: 0 },
    { id: randomUUID(), title: 'Le grand brunch du dimanche', description: 'Œufs mayo, brioche perdue et produits du marché, à partager sans se presser.', date: date(sunday), time: '11:30', category: 'Brunch', capacity: 36, booked: 0 },
    { id: randomUUID(), title: 'Les copains du Zinc', description: 'Une soirée conviviale autour de nos assiettes à partager et de bons vins.', date: date(new Date(nextFriday.getTime() + 7 * 86400000)), time: '19:30', category: 'Soirée', capacity: 52, booked: 0 },
  ];
}

if (!existsSync(dataPath)) {
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify({ reservations: [], events: seedEvents(), creatorEmail: '' }, null, 2));
}

let db;
try {
  db = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (error) {
  throw new Error(`Impossible de lire la base de données ${dataPath}. Vérifiez son format JSON.`, { cause: error });
}
if (!db || typeof db !== 'object' || Array.isArray(db)) {
  throw new Error(`La base de données ${dataPath} doit contenir un objet JSON.`);
}
if (!Array.isArray(db.reservations)) db.reservations = [];
if (!Array.isArray(db.events)) db.events = seedEvents();
if (typeof db.creatorEmail !== 'string') db.creatorEmail = '';

function persist() {
  writeFileSync(dataPath, JSON.stringify(db, null, 2));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function emailProviderReady() {
  const files = readdirSync(projectRoot);
  const hasGmailCredentials = files.some((file) => file.startsWith('client_secret_') && file.endsWith('.json'));
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
    || (existsSync(join(projectRoot, 'token.json')) && hasGmailCredentials),
  );
}

async function sendEmail({ to, subject, html }) {
  try {
    const { sendGmailEmail } = await import('./gmail-mailer.js');
    await sendGmailEmail({ to, subject, html });
    console.log(`E-mail envoyé avec Gmail à ${to}`);
    return 'gmail';
  } catch (gmailError) {
    console.error('Échec de Gmail, tentative avec Resend :', gmailError.message);
  }

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error('Aucun service e-mail configuré. Configurez Gmail ou RESEND_API_KEY et RESEND_FROM_EMAIL.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Échec de Resend, code HTTP ${response.status} : ${responseText.slice(0, 300)}`);
  }

  console.log(`E-mail envoyé avec Resend à ${to}`);
  return 'resend';
}

function emailCard({ preheader, eyebrow, title, content }) {
  const logoUrl = process.env.EMAIL_LOGO_URL || 'https://lezinc-toulon.com/wp-content/uploads/2025/09/favicon.png';
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f2eee7;font-family:Arial,Helvetica,sans-serif;color:#302722">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2eee7">
      <tr><td align="center" style="padding:32px 14px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid #e5dbcf;border-radius:8px;overflow:hidden">
          <tr><td style="height:5px;background:#b8212b;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td align="center" style="padding:28px 24px 30px;background:#29221e">
            <img src="${escapeHtml(logoUrl)}" width="64" height="64" alt="Logo du Zinc Bouillon" style="display:block;width:64px;height:64px;margin:0 auto 14px;padding:5px;border:0;border-radius:8px;background:#fff;outline:none;text-decoration:none">
            <p style="margin:0 0 19px;color:#fffdf9;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Le Zinc Bouillon · Toulon</p>
            <p style="margin:0 0 10px;color:#e89b8f;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${escapeHtml(eyebrow)}</p>
            <h1 style="margin:0;color:#fffdf9;font-size:26px;line-height:1.3;font-weight:600">${escapeHtml(title)}</h1>
          </td></tr>
          <tr><td style="padding:32px 30px 34px;font-size:14px;line-height:1.75">${content}</td></tr>
          <tr><td align="center" style="padding:20px;background:#f5efe7;color:#66594e;font-size:11px;line-height:1.7;border-top:1px solid #e9dfd4">
            Le Zinc Bouillon · 12 rue Molière · 83000 Toulon<br>
            <span style="color:#8c7d71">Au plaisir de vous accueillir prochainement.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function getReservationEmailDetails(reservation) {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeZone: 'Europe/Paris',
  }).format(new Date(`${reservation.date}T12:00:00`));
  const rows = [
    ['Date', dateLabel],
    ['Heure', reservation.time],
    ['Nombre de personnes', `${reservation.guests} ${reservation.guests === 1 ? 'personne' : 'personnes'}`],
    ['Référence', reservation.reference],
  ];
  const details = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0;background:#faf6f0;border:1px solid #e9dfd4;border-radius:6px">${rows.map(([label, value], index) => `<tr><td style="padding:13px 15px;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #eee5db'};color:#76685d;font-size:12px">${escapeHtml(label)}</td><td align="right" style="padding:13px 15px;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #eee5db'};color:#302722;font-size:12px;font-weight:bold">${escapeHtml(value)}</td></tr>`).join('')}</table>`;
  return { dateLabel, details };
}

async function sendReservationEmails(reservation) {
  if (process.env.DISABLE_EMAILS === 'true') {
    return {
      restaurantEmailSent: false,
      customerEmailSent: false,
      error: 'Envoi des e-mails désactivé.',
    };
  }

  const { dateLabel, details } = getReservationEmailDetails(reservation);
  const errors = [];
  let restaurantEmailSent = false;
  let customerEmailSent = false;

  if (db.creatorEmail) {
    try {
      const note = reservation.note ? `<p><strong>Note :</strong> ${escapeHtml(reservation.note)}</p>` : '';
      await sendEmail({
        to: db.creatorEmail,
        subject: `Nouvelle demande de réservation ${reservation.reference} · Le Zinc Bouillon`,
        html: emailCard({
          preheader: `Nouvelle demande de ${reservation.name}, le ${dateLabel} à ${reservation.time}.`,
          eyebrow: 'Nouvelle demande',
          title: 'Une table vous attend',
          content: `<p style="margin:0 0 8px;color:#74675d">Bonjour,</p><p style="margin:0 0 20px;color:#55483f">Une nouvelle demande de réservation vient d’être reçue.</p><h2 style="margin:0 0 8px;color:#702d35;font-size:21px">${escapeHtml(reservation.name)}</h2>${details}<h3 style="margin:26px 0 12px;color:#702d35;font-size:14px">Coordonnées du client</h3><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:0 18px 9px 0;color:#76685d;font-size:12px">Téléphone</td><td style="padding:0 0 9px;color:#302722;font-size:12px;font-weight:bold"><a href="tel:${escapeHtml(reservation.phone)}" style="color:#702d35;text-decoration:none">${escapeHtml(reservation.phone)}</a></td></tr><tr><td style="padding:0 18px 0 0;color:#76685d;font-size:12px">E-mail</td><td style="padding:0;color:#302722;font-size:12px"><a href="mailto:${escapeHtml(reservation.email)}" style="color:#702d35">${escapeHtml(reservation.email)}</a></td></tr></table>${note ? `<div style="margin-top:22px;padding:15px 17px;border-left:3px solid #b8212b;background:#faf4ed;color:#55483f;font-size:12px"><strong>Message du client</strong><br>${note}</div>` : ''}`,
        }),
      });
      restaurantEmailSent = true;
    } catch (error) {
      console.error("Échec de l'e-mail restaurant :", error);
      errors.push('E-mail restaurant non envoyé.');
    }
  } else {
    errors.push('Aucune adresse e-mail du restaurant configurée.');
  }

  try {
    await sendEmail({
      to: reservation.email,
      subject: `Votre demande de réservation ${reservation.reference} · Le Zinc Bouillon`,
      html: emailCard({
        preheader: `Votre demande de réservation ${reservation.reference} a bien été reçue.`,
        eyebrow: 'Demande reçue',
        title: 'Merci, c’est noté !',
        content: `<p style="margin:0 0 8px;color:#74675d">Bonjour ${escapeHtml(reservation.name)},</p><p style="margin:0;color:#55483f">Nous avons bien reçu votre demande de réservation. Vous en trouverez le récapitulatif ci-dessous.</p>${details}<div style="margin:22px 0;padding:16px 18px;border-left:3px solid #b8212b;background:#faf4ed;color:#55483f;font-size:12px;line-height:1.8"><strong style="color:#702d35">Votre demande est en attente de confirmation.</strong><br>Notre équipe vous recontactera si nécessaire.</div><p style="margin:24px 0 0;color:#55483f">À bientôt,<br><strong style="color:#702d35">L’équipe du Zinc Bouillon</strong></p>`,
      }),
    });
    customerEmailSent = true;
  } catch (error) {
    console.error("Échec de l'e-mail client :", error);
    errors.push('E-mail de confirmation client non envoyé.');
  }

  return {
    restaurantEmailSent,
    customerEmailSent,
    error: errors.join(' '),
  };
}

async function sendReservationConfirmationEmail(reservation) {
  if (!reservation.confirmationEmailPending || reservation.confirmationEmailSent) return;
  if (process.env.DISABLE_EMAILS === 'true') {
    console.error(`E-mail de confirmation en attente pour ${reservation.reference} : envoi des e-mails désactivé.`);
    return;
  }

  const attempts = Number(reservation.confirmationEmailAttempts) || 0;
  if (attempts >= maxConfirmationEmailAttempts) {
    console.error(`E-mail de confirmation non envoyé pour ${reservation.reference} après ${attempts} tentatives.`);
    return;
  }

  reservation.confirmationEmailAttempts = attempts + 1;
  persist();
  const { dateLabel, details } = getReservationEmailDetails(reservation);
  try {
    await sendEmail({
      to: reservation.email,
      subject: `Votre réservation est confirmée ${reservation.reference} · Le Zinc Bouillon`,
      html: emailCard({
        preheader: `Votre table est confirmée pour le ${dateLabel} à ${reservation.time}.`,
        eyebrow: 'Réservation confirmée',
        title: 'Votre table est réservée',
        content: `<p style="margin:0 0 8px;color:#74675d">Bonjour ${escapeHtml(reservation.name)},</p><p style="margin:0;color:#55483f">Bonne nouvelle : nous vous confirmons votre réservation au Zinc Bouillon. Nous serons ravis de vous accueillir.</p>${details}<div style="margin:22px 0;padding:16px 18px;border-left:3px solid #b8212b;background:#faf4ed;color:#55483f;font-size:12px;line-height:1.8"><strong style="color:#702d35">Votre réservation est confirmée.</strong><br>Pour toute question ou modification, contactez directement le restaurant.</div><p style="margin:24px 0 0;color:#55483f">À très bientôt,<br><strong style="color:#702d35">L’équipe du Zinc Bouillon</strong></p>`,
      }),
    });
    reservation.confirmationEmailSent = true;
    reservation.confirmationEmailPending = false;
    persist();
    console.log(`E-mail de confirmation envoyé à ${reservation.email} pour ${reservation.reference}.`);
  } catch (error) {
    console.error(`Échec de l'e-mail de confirmation pour ${reservation.reference} :`, error);
    if (reservation.confirmationEmailAttempts < maxConfirmationEmailAttempts) {
      scheduleReservationConfirmation(reservation.id, confirmationEmailRetryDelayMs);
    }
  }
}

async function processReservationConfirmation(reservationId) {
  const reservation = db.reservations.find((item) => item.id === reservationId);
  if (!reservation) return;

  if (reservation.status === 'À confirmer') {
    if (reservation.date < new Date().toISOString().slice(0, 10)) {
      console.warn(`La réservation passée ${reservation.reference} reste en attente et ne sera pas confirmée automatiquement.`);
      return;
    }
    reservation.status = 'Confirmée';
    reservation.autoConfirmedAt = new Date().toISOString();
    reservation.confirmationEmailPending = true;
    persist();
    io.emit('reservation:updated', reservation);
    io.emit('events:updated');
  }

  if (reservation.status === 'Confirmée' && reservation.confirmationEmailPending) {
    await sendReservationConfirmationEmail(reservation);
  }
}

function scheduleReservationConfirmation(reservationId, delayMs) {
  const previousTimer = reservationConfirmationTimers.get(reservationId);
  if (previousTimer) clearTimeout(previousTimer);
  const timer = setTimeout(() => {
    reservationConfirmationTimers.delete(reservationId);
    processReservationConfirmation(reservationId).catch((error) => {
      console.error(`Échec du traitement de confirmation de la réservation ${reservationId} :`, error);
    });
  }, Math.max(0, delayMs));
  reservationConfirmationTimers.set(reservationId, timer);
}

function resumeReservationConfirmations() {
  for (const reservation of db.reservations) {
    if (reservation.status === 'À confirmer') {
      const createdAt = Date.parse(reservation.createdAt);
      if (Number.isNaN(createdAt)) {
        console.error(`Impossible de planifier la confirmation de ${reservation.reference} : date de création invalide.`);
        continue;
      }
      scheduleReservationConfirmation(
        reservation.id,
        createdAt + reservationConfirmationDelayMs - Date.now(),
      );
    } else if (
      reservation.status === 'Confirmée'
      && reservation.confirmationEmailPending
      && (Number(reservation.confirmationEmailAttempts) || 0) < maxConfirmationEmailAttempts
    ) {
      scheduleReservationConfirmation(reservation.id, 0);
    }
  }
}

function requireSession(sessions, message) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token || !sessions.has(token)) return res.status(401).json({ error: message });
    next();
  };
}

const requireAdmin = requireSession(adminSessions, 'Session expirée. Reconnectez-vous.');
const requireCreator = requireSession(creatorSessions, 'Session créateur expirée. Reconnectez-vous.');

app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  if (!origin) return next();
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Cette origine n’est pas autorisée à accéder à l’API.' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/events', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json(db.events.filter((event) => event.date >= today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
});

app.post('/api/admin/login', (req, res) => {
  const expected = process.env.ADMIN_PIN || '1234';
  if (String(req.body?.pin || '') !== expected) return res.status(401).json({ error: 'Code incorrect.' });
  const token = randomUUID();
  adminSessions.add(token);
  res.json({ token });
});

app.post('/api/creators/login', (req, res) => {
  const pin = String(req.body?.pin || '');
  const expected = process.env.CREATOR_PIN || '1304';
  if (!/^\d{4}$/.test(pin) || pin !== expected) return res.status(401).json({ error: 'Code PIN incorrect.' });
  const token = randomUUID();
  creatorSessions.add(token);
  res.json({ token });
});

app.get('/api/creators/reservations', requireCreator, (_req, res) => {
  res.json([...db.reservations].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)));
});

app.delete('/api/creators/reservations/:id', requireCreator, (req, res) => {
  const reservation = db.reservations.find((item) => item.id === req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable.' });

  if (reservation.eventId && reservation.status !== 'Annulée') {
    const event = db.events.find((item) => item.id === reservation.eventId);
    if (event) event.booked = Math.max(0, event.booked - reservation.guests);
  }
  db.reservations = db.reservations.filter((item) => item.id !== reservation.id);
  persist();
  io.emit('reservation:deleted', { id: reservation.id });
  if (reservation.eventId) io.emit('events:updated');
  res.status(204).end();
});

app.get('/api/creators/settings', requireCreator, (_req, res) => {
  res.json({ email: db.creatorEmail, mailReady: Boolean(db.creatorEmail && emailProviderReady()) });
});

app.put('/api/creators/settings', requireCreator, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: 'Saisissez une adresse e-mail valide.' });
  db.creatorEmail = email;
  persist();
  res.json({ email: db.creatorEmail, mailReady: Boolean(db.creatorEmail && emailProviderReady()) });
});

app.get('/api/admin/reservations', requireAdmin, (_req, res) => {
  res.json([...db.reservations].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
});

app.post('/api/reservations', async (req, res) => {
  const { name, email, phone, date, time, guests, note, eventId } = req.body || {};
  const guestCount = Number(guests);
  const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T12:00:00`));
  const validTime = typeof time === 'string' && /^(12:00|12:30|13:00|13:30|19:00|19:30|20:00|20:30|21:00)$/.test(time);
  if (
    typeof name !== 'string' || !name.trim()
    || typeof email !== 'string' || !emailPattern.test(email.trim())
    || typeof phone !== 'string' || !phone.trim()
    || !validDate || !validTime
    || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12
  ) {
    return res.status(400).json({ error: 'Vérifiez les informations de votre réservation (1 à 12 personnes).' });
  }
  if (date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Choisissez une date à venir.' });

  const event = eventId ? db.events.find((item) => item.id === eventId) : null;
  if (eventId && !event) return res.status(404).json({ error: 'Cet événement n’est plus disponible.' });
  if (event && event.booked + guestCount > event.capacity) return res.status(409).json({ error: 'Il ne reste plus assez de places pour cet événement.' });

  const reservation = {
    id: randomUUID(),
    reference: (() => {
      const day = date.slice(2).replace(/-/g, '');
      const prefix = `ZB-${day}-`;
      const lastNumber = db.reservations.reduce((highest, item) => {
        if (!item.reference?.startsWith(prefix)) return highest;
        const number = Number(item.reference.slice(prefix.length));
        return Number.isInteger(number) ? Math.max(highest, number) : highest;
      }, 0);
      return `${prefix}${String(lastNumber + 1).padStart(2, '0')}`;
    })(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    date,
    time,
    guests: guestCount,
    note: String(note || '').trim().slice(0, 500),
    eventId: event?.id || null,
    status: 'À confirmer',
    createdAt: new Date().toISOString(),
  };
  db.reservations.push(reservation);
  if (event) event.booked += reservation.guests;
  persist();
  scheduleReservationConfirmation(reservation.id, reservationConfirmationDelayMs);
  io.emit('reservation:new', reservation);
  if (event) io.emit('events:updated');

  const emailResult = await sendReservationEmails(reservation);
  res.status(201).json({
    ...reservation,
    notificationSent: emailResult.restaurantEmailSent,
    customerEmailSent: emailResult.customerEmailSent,
    notificationError: emailResult.error,
  });
});

app.patch('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  const reservation = db.reservations.find((item) => item.id === req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable.' });
  const allowed = ['À confirmer', 'Confirmée', 'Annulée', 'Terminée'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'Statut invalide.' });
  const previousStatus = reservation.status;
  reservation.status = req.body.status;
  if (reservation.eventId && previousStatus !== 'Annulée' && reservation.status === 'Annulée') {
    const event = db.events.find((item) => item.id === reservation.eventId);
    if (event) event.booked = Math.max(0, event.booked - reservation.guests);
  }
  if (reservation.eventId && previousStatus === 'Annulée' && reservation.status !== 'Annulée') {
    const event = db.events.find((item) => item.id === reservation.eventId);
    if (event) event.booked += reservation.guests;
  }
  if (previousStatus !== 'Confirmée' && reservation.status === 'Confirmée') {
    reservation.confirmationEmailPending = true;
  }
  persist();
  io.emit('reservation:updated', reservation);
  io.emit('events:updated');
  if (reservation.status === 'Confirmée' && reservation.confirmationEmailPending) {
    await sendReservationConfirmationEmail(reservation);
  }
  res.json(reservation);
});

app.post('/api/admin/events', requireAdmin, (req, res) => {
  const { title, description, date, time, capacity, category } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim() || !date || !time || !Number.isInteger(Number(capacity)) || Number(capacity) < 1) {
    return res.status(400).json({ error: 'Complétez les champs obligatoires.' });
  }
  const event = { id: randomUUID(), title: title.trim(), description: description.trim(), date, time, capacity: Number(capacity), category: category || 'Soirée', booked: 0 };
  db.events.push(event);
  persist();
  io.emit('events:updated');
  res.status(201).json(event);
});

app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  const { title, description, date, time, capacity, category } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim() || !date || !time || !Number.isInteger(Number(capacity)) || Number(capacity) < event.booked) {
    return res.status(400).json({ error: 'Vérifiez les champs et la capacité (réservations déjà prises).' });
  }
  Object.assign(event, { title: title.trim(), description: description.trim(), date, time, capacity: Number(capacity), category: category || 'Soirée' });
  persist();
  io.emit('events:updated');
  res.json(event);
});

app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  db.events = db.events.filter((item) => item.id !== req.params.id);
  persist();
  io.emit('events:updated');
  res.status(204).end();
});

resumeReservationConfirmations();

app.use(express.static(clientBuildPath));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(join(clientBuildPath, 'index.html'), (error) => {
    if (error) next(error);
  });
});

httpServer.listen(port, '0.0.0.0', () => console.log(`Le Zinc Bouillon API écoute sur http://localhost:${port}`));
