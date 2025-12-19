/**
 * API Key Admin Panel - Frontend Application
 */

let authToken = null;

// Check if user is logged in on page load
window.addEventListener('DOMContentLoaded', () => {
  authToken = localStorage.getItem('authToken');

  if (authToken) {
    showMainApp();
    loadKeys();
  } else {
    showLoginScreen();
  }
});

// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      throw new Error('Ogiltiga inloggningsuppgifter');
    }

    const data = await response.json();
    authToken = data.token;
    localStorage.setItem('authToken', authToken);

    showMainApp();
    loadKeys();
  } catch (error) {
    showError('loginError', error.message);
  }
});

// Key Form Handler
document.getElementById('keyForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const keyData = {
    keyName: document.getElementById('keyName').value,
    value: document.getElementById('keyValue').value,
    serviceName: document.getElementById('serviceName').value,
    description: document.getElementById('description').value
  };

  try {
    const response = await fetch('/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(keyData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Kunde inte spara nyckel');
    }

    showAlert('Nyckel sparad!', 'success');
    closeKeyModal();
    loadKeys();
  } catch (error) {
    showAlert(error.message, 'error');
  }
});

// Load all keys
async function loadKeys() {
  try {
    const response = await fetch('/api/keys', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) {
      throw new Error('Kunde inte hämta nycklar');
    }

    const data = await response.json();
    renderKeys(data.keys);
  } catch (error) {
    showAlert(error.message, 'error');
    document.getElementById('keysList').innerHTML =
      `<div class="alert alert-error">${error.message}</div>`;
  }
}

// Render keys list
function renderKeys(keys) {
  const container = document.getElementById('keysList');

  if (keys.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Inga API-nycklar ännu. Lägg till din första!</p>';
    return;
  }

  container.innerHTML = keys.map(key => `
    <div class="key-item">
      <div class="key-info">
        <h3>${key.keyName}</h3>
        <div class="key-service">${key.serviceName || 'Ingen tjänst angiven'}</div>
        <div class="key-value">${key.maskedValue}</div>
        ${key.description ? `<p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">${key.description}</p>` : ''}
        <small style="color: var(--text-muted);">
          Uppdaterad: ${new Date(key.updatedAt).toLocaleString('sv-SE')}
        </small>
      </div>
      <div class="key-actions">
        <button onclick="testConnection('${key.keyName}', '${key.serviceName}')" class="success">
          Testa
        </button>
        <button onclick="editKey('${key.keyName}')" class="secondary">
          Redigera
        </button>
        <button onclick="deleteKey('${key.keyName}')" class="danger">
          Ta bort
        </button>
      </div>
    </div>
  `).join('');
}

// Test connection
async function testConnection(keyName, serviceName) {
  try {
    showAlert('Testar anslutning...', 'warning');

    const response = await fetch(`/api/keys/${keyName}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ serviceName })
    });

    const result = await response.json();

    if (result.success) {
      showAlert(`✅ ${keyName}: ${result.message}`, 'success');
    } else {
      showAlert(`❌ ${keyName}: ${result.message}`, 'error');
    }
  } catch (error) {
    showAlert(error.message, 'error');
  }
}

// Edit key
async function editKey(keyName) {
  try {
    const response = await fetch(`/api/keys/${keyName}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) {
      throw new Error('Kunde inte hämta nyckel');
    }

    const data = await response.json();
    const key = data.key;

    // Populate form
    document.getElementById('modalTitle').textContent = 'Redigera API-nyckel';
    document.getElementById('keyName').value = key.keyName;
    document.getElementById('keyName').readOnly = true; // Don't allow changing key name
    document.getElementById('keyValue').value = key.value;
    document.getElementById('serviceName').value = key.serviceName || '';
    document.getElementById('description').value = key.description || '';

    openKeyModal();
  } catch (error) {
    showAlert(error.message, 'error');
  }
}

// Delete key
async function deleteKey(keyName) {
  if (!confirm(`Är du säker på att du vill ta bort ${keyName}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/keys/${keyName}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) {
      throw new Error('Kunde inte ta bort nyckel');
    }

    showAlert('Nyckel borttagen!', 'success');
    loadKeys();
  } catch (error) {
    showAlert(error.message, 'error');
  }
}

// Modal functions
function openAddKeyModal() {
  document.getElementById('modalTitle').textContent = 'Lägg till API-nyckel';
  document.getElementById('keyForm').reset();
  document.getElementById('keyName').readOnly = false;
  document.getElementById('keyModal').classList.add('active');
}

function openKeyModal() {
  document.getElementById('keyModal').classList.add('active');
}

function closeKeyModal() {
  document.getElementById('keyModal').classList.remove('active');
  document.getElementById('keyForm').reset();
  document.getElementById('keyName').readOnly = false;
}

// Toggle password visibility
function togglePasswordVisibility() {
  const input = document.getElementById('keyValue');
  const checkbox = document.getElementById('showPassword');
  input.type = checkbox.checked ? 'text' : 'password';
}

// UI Helper functions
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
}

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.classList.remove('hidden');

  setTimeout(() => {
    element.classList.add('hidden');
  }, 5000);
}

function showAlert(message, type = 'success') {
  const alertsContainer = document.getElementById('alerts');
  const alertClass = type === 'success' ? 'alert-success' :
                     type === 'error' ? 'alert-error' : 'alert-warning';

  const alert = document.createElement('div');
  alert.className = `alert ${alertClass}`;
  alert.textContent = message;

  alertsContainer.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 5000);
}

function logout() {
  localStorage.removeItem('authToken');
  authToken = null;
  showLoginScreen();
}

// Close modal on outside click
document.getElementById('keyModal').addEventListener('click', (e) => {
  if (e.target.id === 'keyModal') {
    closeKeyModal();
  }
});
