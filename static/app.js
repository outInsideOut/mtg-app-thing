const form = document.getElementById('fetch-form');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const submitBtn = document.getElementById('submit-btn');

// --- Accordion toggles ---
document.querySelectorAll('.filter-header').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.filter-section').classList.toggle('open');
  });
});

// --- Type checkboxes + optional counts ---
const typeBody    = document.getElementById('type-body');
const typeSummary = document.getElementById('type-summary');

const META_TYPES = {
  'non-land-permanent': ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'],
  'non-permanent':      ['instant', 'sorcery'],
  'land-meta':          ['land'],
};

// Map each individual type value → which meta-type owns it (if any)
const subTypeOwner = {};
Object.entries(META_TYPES).forEach(([meta, subs]) => subs.forEach(s => subTypeOwner[s] = meta));

function getIndRow(value) {
  return [...typeBody.querySelectorAll('#individual-type-grid .type-row')]
    .find(row => row.querySelector('input[type="checkbox"]')?.value === value);
}

function syncMetaDisable() {
  // For each active meta-type, disable its sub-type rows
  const activeMetas = new Set(
    [...typeBody.querySelectorAll('.meta-type:checked')].map(cb => cb.value)
  );
  typeBody.querySelectorAll('#individual-type-grid .type-row').forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    const owner = subTypeOwner[cb.value];
    if (owner && activeMetas.has(owner)) {
      cb.checked = false;
      row.querySelector('.type-count').classList.remove('visible');
      row.querySelector('.type-count').value = '';
      row.classList.add('disabled');
    } else {
      row.classList.remove('disabled');
    }
  });
}

typeBody.addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const row = e.target.closest('.type-row');
  const countInput = row.querySelector('.type-count');
  if (e.target.checked) {
    countInput.classList.add('visible');
  } else {
    countInput.classList.remove('visible');
    countInput.value = '';
  }
  if (e.target.classList.contains('meta-type')) syncMetaDisable();
  updateTypeSummary();
});

typeBody.addEventListener('input', (e) => {
  if (e.target.classList.contains('type-count')) updateTypeSummary();
});

function getTypeSelections() {
  const typed_counts = {};
  const free_types   = [];

  typeBody.querySelectorAll('.type-row:not(.disabled)').forEach(row => {
    const cb         = row.querySelector('input[type="checkbox"]');
    const countInput = row.querySelector('.type-count');
    if (!cb.checked) return;

    // Expand meta-types to their constituent types
    const types = META_TYPES[cb.value] ?? [cb.value];
    const val   = parseInt(countInput.value);
    if (val > 0) {
      typed_counts[cb.value] = { types, count: val };
    } else {
      free_types.push(...types);
    }
  });
  return { typed_counts, free_types };
}

function updateTypeSummary() {
  const { typed_counts, free_types } = getTypeSelections();
  const counted = Object.entries(typed_counts).map(([k, v]) => `${v.count}× ${formatTypeName(k)}`);
  const freeLabel = free_types.length ? [...new Set(free_types)].map(capitalize) : [];
  const all = [...counted, ...freeLabel];
  typeSummary.textContent = all.length === 0 ? 'Any' : all.length <= 3 ? all.join(', ') : `${all.length} types`;
}

function formatTypeName(val) {
  const names = { 'non-land-permanent': 'Non-land Perm', 'non-permanent': 'Non-permanent', 'land-meta': 'Land' };
  return names[val] ?? capitalize(val);
}

// --- Rarity checkboxes ---
const rarityBody = document.getElementById('rarity-body');
const raritySummary = document.getElementById('rarity-summary');

rarityBody.addEventListener('change', updateRaritySummary);

function getSelectedRarities() {
  return [...rarityBody.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
}

function updateRaritySummary() {
  const checked = getSelectedRarities();
  raritySummary.textContent = checked.length === 0 ? 'Any' : checked.map(capitalize).join(', ');
}

// --- Set checkboxes ---
const setList = document.getElementById('set-list');
const setSummary = document.getElementById('set-summary');

function getSelectedSets() {
  return [...setList.querySelectorAll('input[type="checkbox"]:checked')]
    .map(cb => cb.value)
    .filter(v => v !== '');
}

setList.addEventListener('change', updateSetSummary);

function updateSetSummary() {
  const selected = getSelectedSets();
  if (selected.length === 0) {
    setSummary.textContent = 'Any';
  } else if (selected.length <= 2) {
    setSummary.textContent = selected.map(c => c.toUpperCase()).join(', ');
  } else {
    setSummary.textContent = `${selected.length} sets`;
  }
}

// Load expansion sets on page load
(async () => {
  try {
    const resp = await fetch('/sets');
    const sets = await resp.json();
    if (sets.error) return;
    for (const s of sets) {
      const label = document.createElement('label');
      label.className = 'checkbox-item set-item';
      label.innerHTML = `<input type="checkbox" value="${s.code}" /> ${s.name} (${s.code.toUpperCase()})`;
      setList.appendChild(label);
    }
  } catch (_) {}
})();

// --- Form submit ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = parseInt(document.getElementById('n').value) || 5;
  const { typed_counts, free_types } = getTypeSelections();
  const rarities = getSelectedRarities();
  const sets = getSelectedSets();

  document.querySelectorAll('.filter-section.open').forEach(s => s.classList.remove('open'));

  resultsEl.innerHTML = '';
  statusEl.className = '';
  statusEl.innerHTML = '<span class="spinner"></span> Fetching cards…';
  submitBtn.disabled = true;

  try {
    const resp = await fetch('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, typed_counts, free_types, rarities, sets }),
    });
    const data = await resp.json();

    if (data.error) {
      statusEl.className = 'error';
      statusEl.textContent = data.error;
    } else {
      statusEl.textContent = `Showing ${data.cards.length} card${data.cards.length !== 1 ? 's' : ''}`;
      renderCards(data.cards);
    }
  } catch (err) {
    statusEl.className = 'error';
    statusEl.textContent = 'Network error — is the server running?';
  } finally {
    submitBtn.disabled = false;
  }
});

function renderCards(cards) {
  resultsEl.innerHTML = '';
  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'card';
    el.title = 'Open on Scryfall';
    el.addEventListener('click', () => window.open(card.scryfall_uri, '_blank'));
    el.innerHTML = `
      ${card.image ? `<img src="${card.image}" alt="${card.name}" loading="lazy" />` : ''}
      <div class="card-info">
        <div class="card-name">${card.name}</div>
        <div class="card-type">${card.type_line}</div>
        <div class="card-meta">
          <span class="rarity-${card.rarity}">${capitalize(card.rarity)}</span>
          <span>${card.set_name}</span>
        </div>
      </div>
    `;
    resultsEl.appendChild(el);
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
