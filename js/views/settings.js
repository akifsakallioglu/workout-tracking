// Ayarlar: yedek alma, yedeği geri yükleme ve kalıcı depolama.
import { activeSession, backupFileName, buildBackup, formatDateTime, parseBackup } from '../logic.js';
import {
  isStoragePersisted,
  loadProgram,
  loadSessions,
  loadSettings,
  requestPersistentStorage,
  restoreBackup,
  saveSettings,
} from '../store.js';
import { appHeader, errorReason, escapeHtml, icon } from '../ui.js';

export async function renderSettings(container) {
  const state = {
    settings: await loadSettings(),
    sessionCount: (await loadSessions()).length,
    persisted: await isStoragePersisted(),
    backupMessage: '',
    pending: null, // denetlenmiş, onay bekleyen yedek
    restoreMessage: '',
    restoreFailed: false,
    storageMessage: '',
    busy: false,
  };
  const canShare = typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File(['{}'], 'yedek.json', { type: 'application/json' })] });

  function render() {
    const { lastBackupAt } = state.settings;
    container.innerHTML = `
      ${appHeader('#/ayarlar')}
      <header class="page-head">
        <h1>Ayarlar</h1>
      </header>

      <section class="card settings-section" aria-labelledby="backup-title">
        <h2 id="backup-title" class="card-title">${icon('download')}Yedek</h2>
        <p id="last-backup">Son yedek: ${lastBackupAt ? formatDateTime(lastBackupAt) : 'henüz yedek alınmadı'}</p>
        <p class="muted">Verileriniz yalnızca bu cihazda duruyor. Yedek dosyasını telefonunuzda ya da Drive gibi başka bir yerde saklayın; telefon değişirse ya da tarayıcı verileri silinirse buradan geri yüklersiniz.</p>
        <div class="actions">
          <button type="button" class="button primary" data-action="download"${state.busy ? ' disabled' : ''}>Yedeği indir</button>
          ${canShare ? `<button type="button" class="button secondary" data-action="share"${state.busy ? ' disabled' : ''}>Paylaş…</button>` : ''}
        </div>
        <p id="backup-message" class="status-message" role="status">${escapeHtml(state.backupMessage)}</p>
      </section>

      <section class="card settings-section" aria-labelledby="restore-title">
        <h2 id="restore-title" class="card-title">${icon('restore')}Yedeği geri yükle</h2>
        <p class="muted">Yedek dosyası seçin. Dosya önce denetlenir; onaylarsanız bu cihazdaki program ve antrenmanlar yedektekilerle değiştirilir.</p>
        <label class="file-field">
          <span>Yedek dosyası</span>
          <input id="restore-file" type="file" accept=".json,application/json"${state.busy ? ' disabled' : ''}>
        </label>
        ${state.pending ? restoreSummaryHtml() : ''}
        <p id="restore-message" class="${state.restoreFailed ? 'message' : 'status-message'}" role="${state.restoreFailed ? 'alert' : 'status'}">${escapeHtml(state.restoreMessage)}</p>
      </section>

      <section class="card settings-section" aria-labelledby="storage-title">
        <h2 id="storage-title" class="card-title">${icon('database')}Kalıcı depolama</h2>
        <p id="storage-status">${storageText()}</p>
        ${state.persisted === false ? `<div class="actions"><button type="button" class="button secondary" data-action="persist">Kalıcı depolama iste</button></div>` : ''}
        <p id="storage-message" class="status-message" role="status">${escapeHtml(state.storageMessage)}</p>
      </section>`;
  }

  function restoreSummaryHtml() {
    const { backup } = state.pending;
    const active = activeSession(backup.sessions);
    return `
      <div id="restore-summary" class="restore-summary">
        <p>Yedek tarihi: ${formatDateTime(backup.exportedAt)} · ${backup.sessions.length} antrenman${active ? ` (devam eden: ${escapeHtml(active.dayName)})` : ''}.</p>
        <p>Bu cihazdaki ${state.sessionCount} antrenman ve program, yedektekilerle değiştirilecek. Bu işlem geri alınamaz.</p>
        <div class="actions">
          <button type="button" class="button danger" data-action="restore"${state.busy ? ' disabled' : ''}>Geri yükle</button>
          <button type="button" class="button secondary" data-action="cancel-restore"${state.busy ? ' disabled' : ''}>Vazgeç</button>
        </div>
      </div>`;
  }

  function storageText() {
    if (state.persisted === null) return 'Bu tarayıcı kalıcı depolamayı desteklemiyor.';
    return state.persisted
      ? 'Kalıcı depolama: açık. Tarayıcı, yer açmak için verilerinizi kendiliğinden silmez.'
      : 'Kalıcı depolama: kapalı. Tarayıcı, cihazda yer azalırsa verileri silebilir.';
  }

  async function exportBackup(share) {
    state.busy = true;
    render();
    try {
      const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
      const now = new Date();
      const text = JSON.stringify(buildBackup(program, sessions, now.toISOString()), null, 2);
      const file = new File([text], backupFileName(now), { type: 'application/json' });
      if (share) {
        try {
          await navigator.share({ files: [file], title: 'Antrenman yedeği' });
        } catch (error) {
          if (error.name === 'AbortError') return; // kullanıcı paylaşmaktan vazgeçti
          throw error;
        }
      } else {
        download(file);
      }
      state.settings = { ...state.settings, lastBackupAt: now.toISOString() };
      await saveSettings(state.settings);
      state.backupMessage = `Yedek hazırlandı: ${file.name} (${sessions.length} antrenman).`;
    } catch (error) {
      console.warn('Yedek alınamadı', error);
      state.backupMessage = `Yedek alınamadı. ${errorReason(error)}`;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function readBackup(input) {
    const [file] = input.files;
    state.pending = null;
    state.restoreMessage = '';
    state.restoreFailed = false;
    if (!file) {
      render();
      return;
    }
    const { backup, error } = parseBackup(await file.text());
    if (error) {
      state.restoreMessage = `${error} Hiçbir şey değiştirilmedi.`;
      state.restoreFailed = true;
    } else {
      state.pending = { backup };
    }
    render();
  }

  async function restore() {
    const { backup } = state.pending;
    state.busy = true;
    render();
    try {
      await restoreBackup(backup.program, backup.sessions);
      state.pending = null;
      state.sessionCount = backup.sessions.length;
      state.restoreMessage = `Yedek geri yüklendi: ${backup.sessions.length} antrenman.`;
      state.restoreFailed = false;
    } catch (error) {
      console.warn('Yedek geri yüklenemedi', error);
      state.restoreMessage = `Yedek geri yüklenemedi; hiçbir şey değiştirilmedi. ${errorReason(error)}`;
      state.restoreFailed = true;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function persist() {
    state.persisted = await requestPersistentStorage();
    state.storageMessage = state.persisted
      ? ''
      : 'Tarayıcı isteği şimdilik kabul etmedi. Uygulamayı ana ekrana ekleyip düzenli kullandıkça tarayıcılar genellikle kabul eder.';
    render();
  }

  container.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || state.busy) return;
    if (action === 'download') exportBackup(false);
    else if (action === 'share') exportBackup(true);
    else if (action === 'restore') restore();
    else if (action === 'cancel-restore') {
      state.pending = null;
      state.restoreMessage = '';
      render();
    } else if (action === 'persist') persist();
  });

  container.addEventListener('change', (event) => {
    if (event.target.id === 'restore-file') readBackup(event.target);
  });

  render();
  return {};
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
