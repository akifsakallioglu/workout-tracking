import { initStore } from './store.js';
import { renderExerciseLogger } from './views/exercise-logger.js';

const app = document.getElementById('app');

try {
  await initStore();
  await renderExerciseLogger(app);
} catch (error) {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent =
    'Uygulama açılamadı: tarayıcı veritabanına erişilemiyor. Gizli sekmede ya da site verileri engelliyken bu olabilir.';
  app.replaceChildren(message);
}
