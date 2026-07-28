
/**
 * Data portability widget for localStorage apps.
 *
 * localStorage works fine on file:// (local files) and stays in sync as long
 * as you open the same file from the same path. But if you move the file,
 * rename it, or open it on a different machine, localStorage starts empty.
 *
 * This widget solves that without any complex storage migration. It injects
 * a small floating button in the corner of the app that lets the user:
 *
 *   💾 Export — download all localStorage data as app-data.json
 *   📂 Import — restore from a previously exported app-data.json
 *
 * The data file is plain JSON — readable, backupable, and transferable.
 */

/**
 * Returns true if the source string contains any localStorage usage.
 * @param {string} code
 */
export function hasLocalStorage(code) {
  return /localStorage/.test(code);
}

/**
 * Returns a self-contained <script> block that mounts the widget.
 * Should be injected just before </body>.
 */
export function getDataWidget() {
  return `
<!-- artifact-to-pwa: data portability widget -->
<script>
(function () {
  var WRAP_STYLE = [
    'position:fixed',
    'bottom:14px',
    'right:14px',
    'z-index:2147483647',
    'display:flex',
    'flex-direction:column',
    'align-items:flex-end',
    'gap:5px',
    'font-family:system-ui,-apple-system,sans-serif',
  ].join(';');

  var BTN_STYLE = [
    'background:rgba(10,10,10,0.72)',
    'color:rgba(255,255,255,0.9)',
    'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:8px',
    'padding:5px 12px',
    'font-size:11px',
    'letter-spacing:.02em',
    'cursor:pointer',
    'backdrop-filter:blur(10px)',
    '-webkit-backdrop-filter:blur(10px)',
    'white-space:nowrap',
    'user-select:none',
  ].join(';');

  var LABEL_STYLE = [
    'color:rgba(255,255,255,0.3)',
    'font-size:9px',
    'letter-spacing:.06em',
    'text-align:right',
    'padding-right:2px',
    'text-transform:uppercase',
  ].join(';');

  function exportData() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    if (!Object.keys(out).length) {
      alert('No saved data found yet — use the app first, then export.');
      return;
    }
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'app-data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Expected a JSON object.');
          }
          var keys = Object.keys(data);
          if (!keys.length) {
            alert('The file appears to be empty.');
            return;
          }
          keys.forEach(function (k) { localStorage.setItem(k, data[k]); });
          location.reload();
        } catch (err) {
          alert('Import failed — make sure you select a valid app-data.json file.\n\nDetails: ' + err.message);
        }
      };

      reader.onerror = function () {
        alert('Could not read the file.');
      };

      reader.readAsText(file);
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  function mount() {
    var wrap = document.createElement('div');
    wrap.setAttribute('style', WRAP_STYLE);

    var label = document.createElement('div');
    label.setAttribute('style', LABEL_STYLE);
    label.textContent = 'Data';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;';

    function btn(text, handler) {
      var b = document.createElement('button');
      b.setAttribute('style', BTN_STYLE);
      b.textContent = text;
      b.addEventListener('click', handler);
      b.addEventListener('mouseover', function () { b.style.background = 'rgba(10,10,10,0.9)'; });
      b.addEventListener('mouseout',  function () { b.style.background = 'rgba(10,10,10,0.72)'; });
      return b;
    }

    row.appendChild(btn('💾 Export', exportData));
    row.appendChild(btn('📂 Import', importData));
    wrap.appendChild(label);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}());
</script>`;
}
