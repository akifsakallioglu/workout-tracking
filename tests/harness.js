// Küçük test altyapısı: test() ile kaydedilen testleri run() çalıştırır ve sonucu sayfaya yazar.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message = 'Beklenen koşul sağlanmadı') {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message ? `${message}: ` : ''}beklenen ${e}, gelen ${a}`);
  }
}

export async function run() {
  const list = document.getElementById('results');
  const summary = document.getElementById('summary');
  let passed = 0;
  for (const { name, fn } of tests) {
    const item = document.createElement('li');
    try {
      await fn();
      passed++;
      item.className = 'pass';
      item.textContent = `✓ ${name}`;
    } catch (error) {
      item.className = 'fail';
      item.textContent = `✗ ${name}: ${error.message}`;
      console.error(name, error);
    }
    list.append(item);
  }
  summary.textContent = `${passed}/${tests.length} test geçti`;
  summary.dataset.status = tests.length > 0 && passed === tests.length ? 'pass' : 'fail';
  document.body.dataset.done = 'true';
}
