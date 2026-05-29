import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'Wse81cCAXA6GfvKE3Wwc';
const CAM_CONTACT_ID = 'fWKdewTMHyA43pb3CBIz';

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── GHL helper ──
async function ghlFetch(path, options = {}) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Search Contacts ──
app.get('/api/search-contacts', async (req, res) => {
  try {
    const query = req.query.q || '';
    const tagged = req.query.tagged || '';
    const limit = tagged && !query ? 100 : 20;
    let url = `/contacts/?locationId=${LOCATION_ID}&limit=${limit}`;
    if (query) url += `&query=${encodeURIComponent(query)}`;

    const data = await ghlFetch(url);
    let contacts = (data.contacts || []).map(c => ({
      id: c.id,
      name: [c.firstNameRaw, c.lastNameRaw].filter(Boolean).join(' ') || c.contactName || 'Unknown',
      email: c.email || null,
      phone: c.phone || null,
      photo: c.profilePhoto || null,
      tags: c.tags || [],
      company: c.companyName || null,
    }));

    if (tagged) {
      contacts = contacts.filter(c => c.tags.includes(tagged));
    }

    res.json({ contacts });
  } catch (err) {
    console.error('search-contacts error:', err);
    res.status(500).json({ contacts: [], error: err.message });
  }
});

// ── Log Session ──
app.post('/api/log-session', async (req, res) => {
  try {
    const session = req.body;
    const noteHtml = buildNoteHtml(session);
    const results = { camNote: false, clientNote: false, clientFound: null };

    // Always log on Cam's contact
    try {
      await ghlFetch(`/contacts/${CAM_CONTACT_ID}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteHtml }),
      });
      results.camNote = true;
    } catch (err) {
      console.error('Failed to create note on Cam:', err.message);
    }

    // Log on client contact
    if (session.contactId) {
      try {
        await ghlFetch(`/contacts/${session.contactId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ body: noteHtml }),
        });
        results.clientNote = true;
        results.clientFound = session.client;
      } catch (err) {
        console.error('Failed to create note on client:', err.message);
      }
    } else if (session.client) {
      try {
        const data = await ghlFetch(`/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(session.client)}&limit=1`);
        const contact = data.contacts?.[0];
        if (contact) {
          results.clientFound = contact.contactName;
          await ghlFetch(`/contacts/${contact.id}/notes`, {
            method: 'POST',
            body: JSON.stringify({ body: noteHtml }),
          });
          results.clientNote = true;
        }
      } catch (err) {
        console.error('Failed to create note on client:', err.message);
      }
    }

    res.json({ success: true, ...results });
  } catch (err) {
    console.error('log-session error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function buildNoteHtml(session) {
  const skippedLabel = session.items_skipped > 0
    ? `<span style="color:#ef4444;font-weight:bold;">${session.items_skipped} items skipped</span>`
    : '<span style="color:#22c55e;font-weight:bold;">All items completed</span>';

  return `
<h3>${session.session_type || 'Studio'} Session Checklist — ${session.completion_rate}</h3>
<table style="border-collapse:collapse;width:100%;">
  <tr><td style="padding:4px 8px;font-weight:bold;">Type</td><td style="padding:4px 8px;">${session.session_type || 'In-Studio'}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Producer</td><td style="padding:4px 8px;">${session.producer}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Client</td><td style="padding:4px 8px;">${session.client}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Cameras</td><td style="padding:4px 8px;">${session.cameras}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Guests</td><td style="padding:4px 8px;">${session.guests}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Checked</td><td style="padding:4px 8px;">${session.items_checked} / ${session.total_items}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Status</td><td style="padding:4px 8px;">${skippedLabel}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Duration</td><td style="padding:4px 8px;">${session.duration_minutes} min</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Timestamp</td><td style="padding:4px 8px;">${new Date(session.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td></tr>
</table>
<p style="margin-top:8px;font-size:12px;color:#888;">Logged by L3 Studio Hub</p>
  `.trim();
}

app.listen(PORT, () => {
  console.log(`L3 Studio Hub running on port ${PORT}`);
});
