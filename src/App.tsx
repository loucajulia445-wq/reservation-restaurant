import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Users } from 'lucide-react';

type Step = 'date' | 'details' | 'confirmation';
type BookingDraft = {
  date: string;
  time: string;
  guests: string;
  name: string;
  email: string;
  phone: string;
  note: string;
};
type Reservation = {
  reference: string;
  name: string;
  date: string;
  time: string;
  guests: number;
};

function isReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.reference === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.date === 'string'
    && typeof candidate.time === 'string'
    && typeof candidate.guests === 'number';
}

const paths: Record<Step, string> = {
  date: '#/reservation',
  details: '#/reservation/coordonnees',
  confirmation: '#/reservation/confirmation',
};
const timeSlots = ['12:00', '12:30', '13:00', '13:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
const initialDraft: BookingDraft = {
  date: '',
  time: '19:00',
  guests: '2',
  name: '',
  email: '',
  phone: '',
  note: '',
};

function currentStep(): Step {
  if (window.location.hash.endsWith('/confirmation')) return 'confirmation';
  if (window.location.hash.endsWith('/coordonnees')) return 'details';
  return 'date';
}

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function readDraft(): BookingDraft {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('zinc-booking-draft') || 'null');
    if (
      saved && typeof saved === 'object' &&
      'date' in saved && typeof saved.date === 'string' &&
      'time' in saved && typeof saved.time === 'string' &&
      'guests' in saved && typeof saved.guests === 'string' &&
      'name' in saved && typeof saved.name === 'string' &&
      'email' in saved && typeof saved.email === 'string' &&
      'phone' in saved && typeof saved.phone === 'string' &&
      'note' in saved && typeof saved.note === 'string'
    ) {
      return {
        date: saved.date,
        time: saved.time,
        guests: saved.guests,
        name: saved.name,
        email: saved.email,
        phone: saved.phone,
        note: saved.note,
      };
    }
  } catch {
    sessionStorage.removeItem('zinc-booking-draft');
  }
  return initialDraft;
}

function readReservation(): Reservation | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('zinc-booking-confirmation') || 'null');
    if (isReservation(saved)) return saved;
  } catch {
    sessionStorage.removeItem('zinc-booking-confirmation');
  }
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

async function createReservation(draft: BookingDraft): Promise<Reservation> {
  const response = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...draft,
      guests: Number(draft.guests),
      eventId: null,
    }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Impossible d’enregistrer votre réservation.';
    throw new Error(message);
  }
  if (!isReservation(result)) {
    throw new Error('La réponse du serveur est invalide. Veuillez réessayer.');
  }
  return {
    reference: result.reference,
    name: result.name,
    date: result.date,
    time: result.time,
    guests: result.guests,
  };
}

export default function App() {
  const [step, setStep] = useState<Step>(currentStep);
  const [draft, setDraft] = useState<BookingDraft>(readDraft);
  const [confirmation, setConfirmation] = useState<Reservation | null>(readReservation);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${paths.date}`);
    const syncStep = () => setStep(currentStep());
    window.addEventListener('hashchange', syncStep);
    return () => window.removeEventListener('hashchange', syncStep);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('zinc-booking-draft', JSON.stringify(draft));
  }, [draft]);

  const navigate = (nextStep: Step) => {
    setError('');
    window.location.hash = paths[nextStep];
    setStep(nextStep);
  };

  const updateDraft = (updates: Partial<BookingDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  const continueToDetails = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate('details');
  };

  const submitBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.date || !draft.time || !draft.guests) {
      setError('Choisissez d’abord une date, une heure et le nombre de personnes.');
      navigate('date');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const created = await createReservation(draft);
      setConfirmation(created);
      sessionStorage.setItem('zinc-booking-confirmation', JSON.stringify(created));
      navigate('confirmation');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Impossible d’enregistrer votre réservation.');
    } finally {
      setSubmitting(false);
    }
  };

  const newBooking = () => {
    setDraft(initialDraft);
    setConfirmation(null);
    sessionStorage.removeItem('zinc-booking-confirmation');
    navigate('date');
  };

  const hasBookingDetails = Boolean(draft.date && draft.time && draft.guests);
  const safeStep = step === 'confirmation' && !confirmation ? 'date' : step;
  const stepIndex = safeStep === 'date' ? 1 : safeStep === 'details' ? 2 : 3;

  return (
    <main className="booking-app">
      <header className="app-header">
        <a className="brand" href="#/reservation" aria-label="Le Zinc Bouillon — réservation">
          <span className="brand-mark">Z<span>.</span></span>
          <span className="brand-name">LE ZINC<br /><small>BOUILLON</small></span>
        </a>
        <span className="header-caption">RÉSERVATION EN LIGNE</span>
      </header>

      <div className="booking-layout">
        <section className="booking-main" aria-live="polite">
          {safeStep !== 'confirmation' && (
            <div className="progress" aria-label={`Étape ${stepIndex} sur 3`}>
              <span className={stepIndex >= 1 ? 'progress-step active' : 'progress-step'}><i>1</i> Votre créneau</span>
              <span className="progress-line" />
              <span className={stepIndex >= 2 ? 'progress-step active' : 'progress-step'}><i>2</i> Vos coordonnées</span>
              <span className="progress-line" />
              <span className="progress-step"><i>3</i> Confirmation</span>
            </div>
          )}

          {safeStep === 'date' && (
            <form className="booking-card" onSubmit={continueToDetails}>
              <div className="eyebrow"><CalendarDays size={16} /> ÉTAPE 1 SUR 3</div>
              <h1>Choisissez votre<br /><em>moment à table.</em></h1>
              <p className="intro">Indiquez la date, l’heure et le nombre de personnes. Nous vous gardons une place.</p>

              <label className="field-label" htmlFor="booking-date">Date de réservation</label>
              <input
                id="booking-date"
                className="input-control"
                type="date"
                min={localToday()}
                required
                value={draft.date}
                onChange={(event) => updateDraft({ date: event.target.value })}
              />

              <fieldset className="field-group">
                <legend>Choisissez une heure</legend>
                <div className="time-grid">
                  {timeSlots.map((time) => (
                    <button
                      type="button"
                      className={draft.time === time ? 'time-option selected' : 'time-option'}
                      key={time}
                      aria-pressed={draft.time === time}
                      onClick={() => updateDraft({ time })}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="booking-guests">Nombre de personnes</label>
              <select
                id="booking-guests"
                className="input-control"
                value={draft.guests}
                onChange={(event) => updateDraft({ guests: event.target.value })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                  <option value={count} key={count}>{count} {count === 1 ? 'personne' : 'personnes'}</option>
                ))}
              </select>

              <button className="primary-button" type="submit">Continuer <ArrowRight size={17} /></button>
            </form>
          )}

          {safeStep === 'details' && (
            <form className="booking-card" onSubmit={submitBooking}>
              <button className="back-button" type="button" onClick={() => navigate('date')}><ArrowLeft size={15} /> Modifier le créneau</button>
              <div className="eyebrow"><Users size={16} /> ÉTAPE 2 SUR 3</div>
              <h1>Vos coordonnées<br /><em>pour vous recevoir.</em></h1>
              <p className="intro">Un moyen de vous joindre au cas où nous aurions une question à propos de votre réservation.</p>

              <label className="field-label" htmlFor="booking-name">Nom et prénom</label>
              <input id="booking-name" className="input-control" required minLength={2} autoComplete="name" placeholder="Votre nom" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />

              <div className="field-row">
                <div>
                  <label className="field-label" htmlFor="booking-email">Adresse e-mail</label>
                  <input id="booking-email" className="input-control" required type="email" autoComplete="email" placeholder="vous@exemple.fr" value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="booking-phone">Téléphone</label>
                  <input id="booking-phone" className="input-control" required type="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={draft.phone} onChange={(event) => updateDraft({ phone: event.target.value })} />
                </div>
              </div>

              <label className="field-label" htmlFor="booking-note">Une précision à nous communiquer ? <span>(facultatif)</span></label>
              <textarea id="booking-note" className="input-control note-control" rows={3} maxLength={500} placeholder="Allergie, chaise bébé, occasion spéciale…" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} />

              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Enregistrement…' : 'Confirmer ma demande'} {!submitting && <ArrowRight size={17} />}
              </button>
              <p className="privacy-note">Votre demande est transmise directement au restaurant.</p>
            </form>
          )}

          {safeStep === 'confirmation' && confirmation && (
            <section className="booking-card confirmation-card">
              <div className="confirmation-icon"><Check size={30} /></div>
              <div className="eyebrow">RÉSERVATION ENREGISTRÉE</div>
              <h1>Merci {confirmation.name.split(' ')[0]},<br /><em>à très vite !</em></h1>
              <p className="intro">Votre demande a bien été reçue. Le restaurant vous recontactera si nécessaire pour confirmer les détails.</p>
              <div className="reference-card">
                <span>VOTRE RÉFÉRENCE</span>
                <strong>{confirmation.reference}</strong>
                <p>{formatDate(confirmation.date)}<br />{confirmation.time} · {confirmation.guests} {confirmation.guests === 1 ? 'personne' : 'personnes'}</p>
              </div>
              <button className="secondary-button" type="button" onClick={newBooking}>Faire une nouvelle réservation <ArrowRight size={16} /></button>
            </section>
          )}
        </section>

        <aside className="booking-summary" aria-label="Récapitulatif de la réservation">
          <div className="summary-heading"><Clock3 size={17} /><span>VOTRE RÉSERVATION</span></div>
          {hasBookingDetails ? (
            <div className="summary-details">
              <div><span>Date</span><strong>{formatDate(draft.date)}</strong></div>
              <div><span>Heure</span><strong>{draft.time}</strong></div>
              <div><span>Convives</span><strong>{draft.guests} {draft.guests === '1' ? 'personne' : 'personnes'}</strong></div>
            </div>
          ) : (
            <p className="summary-empty">Votre date et votre horaire s’afficheront ici.</p>
          )}
          <div className="summary-note">Une question ? Contactez directement le restaurant pour toute demande particulière.</div>
        </aside>
      </div>

      <footer className="app-footer">
        <span>LE ZINC BOUILLON</span>
        <span>Réservation simple, sans empreinte bancaire.</span>
      </footer>
    </main>
  );
}
