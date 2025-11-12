(() => {
  const state = {
    cwd: "/", // will be replaced after first load
    parent: null,
    view: 'list' // 'list' | 'grid-v' | 'grid-h'
  };

  // Elements
  const tbody = document.getElementById('tbody');
  const statusEl = document.getElementById('status');
  const crumbsEl = document.getElementById('crumbs');
  const pathInput = document.getElementById('pathInput');
  const upBtn = document.getElementById('upBtn');
  const goBtn = document.getElementById('goBtn');
  const newFileBtn = document.getElementById('newFileBtn');
  const newDirBtn = document.getElementById('newDirBtn');
  const uploadForm = document.getElementById('uploadForm');
  const fileInput = document.getElementById('fileInput');

  const viewListBtn = document.getElementById('viewListBtn');
  const viewGridVBtn = document.getElementById('viewGridVBtn');
  const viewGridHBtn = document.getElementById('viewGridHBtn');
  const tableView = document.getElementById('tableView');
  const gridView = document.getElementById('gridView');

  const editorModal = document.getElementById('editorModal');
  const editor = document.getElementById('editor');
  const editTitle = document.getElementById('editTitle');
  const editMeta = document.getElementById('editMeta');
  const editWarn = document.getElementById('editWarn');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  let editingPath = null;

  // Utility
  function fmtSize(n){
    if (n == null) return '-';
    const u=['B','KB','MB','GB','TB'];
    let i=0, x=n;
    while(x>=1024 && i<u.length-1){x/=1024;i++}
    return (i?x.toFixed(1):x)+' '+u[i];
  }
  function fmtDate(s){
    if (!s) return '-';
    try { const d=new Date(s); return d.toLocaleString(); } catch { return s; }
  }
  function setStatus(msg, isError=false){
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#ffb4b4' : '#9aa0a6';
  }
  function renderCrumbs(abs){
    crumbsEl.innerHTML = '';
    const parts = abs.split(/\\\\|\\//).filter(Boolean);
    let acc = abs.startsWith('/') ? '/' : (abs.includes(':\\') ? abs.split('\\')[0]+'\\' : '/');
    const add = (label, p) => {
      const a = document.createElement('a');
      a.href = '#'; a.textContent = label || '/';
      a.onclick = (e)=>{e.preventDefault(); cd(p); };
      crumbsEl.appendChild(a);
      const sep = document.createElement('span'); sep.textContent = '›'; crumbsEl.appendChild(sep);
    };
    if (acc === '/') add('/', '/');
    else add(acc, acc);
    for (let i=0;i<parts.length;i++){
      const label = parts[i];
      acc = acc.endsWith('/') || acc.endsWith('\\') ? acc + label : acc + '/' + label;
      if (i === parts.length-1){
        const s = document.createElement('span'); s.textContent = label; crumbsEl.appendChild(s);
      } else add(label, acc);
    }
    if (!parts.length){
      const s = document.createElement('span'); s.textContent = '/'; crumbsEl.appendChild(s);
    }
  }

  async function api(pathname, params){
    const url = new URL(pathname, location.origin);
    if (params && params.qs){
      Object.entries(params.qs).forEach(([k,v])=> url.searchParams.set(k, v));
    }
    const init = {};
    if (params && params.method) {
      init.method = params.method;
      if (params.body instanceof FormData) {
        init.body = params.body; // browser sets boundary
      } else {
        init.headers = {'Content-Type':'application/json'};
        init.body = JSON.stringify(params.body||{});
      }
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function load(pathLike){
    // skeleton
    tbody.innerHTML = '<tr><td class="empty" colspan="6">読み込み中...</td></tr>';
    gridView.innerHTML = '';
    try{
      const data = await api('/api/list', { qs: { path: pathLike ?? state.cwd } });
      state.cwd = data.path; state.parent = data.parent;
      pathInput.value = state.cwd;
      renderCrumbs(state.cwd);
      render(data.items);
      setStatus(`OK: ${state.cwd}`);
    }catch(e){
      tbody.innerHTML = '<tr><td class="empty" colspan="6">アクセスできません</td></tr>';
      gridView.innerHTML = '';
      setStatus(e.message, true);
    }
  }

  function render(items){
    // Switch view
    if (state.view === 'list') {
      tableView.classList.remove('hidden');
      gridView.classList.add('hidden');
      renderTable(items);
    } else {
      tableView.classList.add('hidden');
      gridView.classList.remove('hidden');
      const horizontal = state.view === 'grid-h';
      gridView.classList.toggle('horizontal', horizontal);
      renderGrid(items);
    }
  }

  function renderTable(items){
    if (!items || !items.length){
      tbody.innerHTML = '<tr><td class="empty" colspan="6">空です</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    for (const it of items){
      const tr = document.createElement('tr');

      const tdName = document.createElement('td'); tdName.className='name';
      const link = document.createElement('a'); link.href='#'; link.textContent = it.name;
      link.onclick = (e)=>{e.preventDefault(); if (it.type==='dir') cd(it.path); else if (it.type==='file') openFile(it); };
      tdName.appendChild(link);

      const tdKind = document.createElement('td');
      const tag = document.createElement('span'); tag.className='tag ' + (it.type==='dir'?'dir':it.type==='file'?'file':'link');
      tag.textContent = it.type;
      tdKind.appendChild(tag);

      const tdSize = document.createElement('td'); tdSize.textContent = it.type==='file' ? fmtSize(it.size) : '-';
      const tdMtime = document.createElement('td'); tdMtime.textContent = fmtDate(it.mtime);

      const tdPerm = document.createElement('td');
      const r = document.createElement('span'); r.className='tag ' + (it.readable?'ok':'no'); r.textContent = 'R';
      const w = document.createElement('span'); w.className='tag ' + (it.writable?'ok':'no'); w.textContent = 'W';
      tdPerm.appendChild(r); tdPerm.appendChild(w);

      const tdAct = document.createElement('td'); tdAct.className='actions';
      const openBtn = document.createElement('button'); openBtn.textContent = it.type==='dir'?'開く':'編集';
      openBtn.onclick = ()=> { if (it.type==='dir') cd(it.path); else openFile(it); };
      tdAct.appendChild(openBtn);

      const renBtn = document.createElement('button'); renBtn.textContent = 'リネーム';
      renBtn.onclick = ()=> renameItem(it);
      tdAct.appendChild(renBtn);

      const delBtn = document.createElement('button'); delBtn.textContent = '削除'; delBtn.className='danger';
      delBtn.onclick = ()=> deleteItem(it);
      tdAct.appendChild(delBtn);

      if (it.type === 'file') {
        const dlBtn = document.createElement('button'); dlBtn.textContent = 'ダウンロード';
        dlBtn.onclick = ()=> downloadItem(it);
        tdAct.appendChild(dlBtn);
      }

      tr.appendChild(tdName); tr.appendChild(tdKind); tr.appendChild(tdSize); tr.appendChild(tdMtime); tr.appendChild(tdPerm); tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }
  }

  function renderGrid(items){
    gridView.innerHTML = '';
    if (!items || !items.length){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '空です';
      gridView.appendChild(empty);
      return;
    }
    for (const it of items){
      const card = document.createElement('div');
      card.className = 'card';

      const title = document.createElement('div'); title.className='title';
      const tag = document.createElement('span'); tag.className='tag ' + (it.type==='dir'?'dir':it.type==='file'?'file':'link');
      tag.textContent = it.type;
      const link = document.createElement('a'); link.href='#'; link.textContent = it.name;
      link.onclick = (e)=>{e.preventDefault(); if (it.type==='dir') cd(it.path); else if (it.type==='file') openFile(it); };
      title.appendChild(tag); title.appendChild(link);

      const meta = document.createElement('div'); meta.className='meta';
      meta.textContent = (it.type==='file' ? fmtSize(it.size) : '-') + ' ・ ' + (fmtDate(it.mtime) || '-');

      const perm = document.createElement('div'); perm.className='perm';
      const r = document.createElement('span'); r.className='tag ' + (it.readable?'ok':'no'); r.textContent = 'R';
      const w = document.createElement('span'); w.className='tag ' + (it.writable?'ok':'no'); w.textContent = 'W';
      perm.appendChild(r); perm.appendChild(w);

      const acts = document.createElement('div'); acts.className='actions';
      const openBtn = document.createElement('button'); openBtn.textContent = it.type==='dir'?'開く':'編集';
      openBtn.onclick = ()=> { if (it.type==='dir') cd(it.path); else openFile(it); };
      acts.appendChild(openBtn);

      const renBtn = document.createElement('button'); renBtn.textContent = 'リネーム';
      renBtn.onclick = ()=> renameItem(it);
      acts.appendChild(renBtn);

      const delBtn = document.createElement('button'); delBtn.textContent = '削除'; delBtn.className='danger';
      delBtn.onclick = ()=> deleteItem(it);
      acts.appendChild(delBtn);

      if (it.type === 'file') {
        const dlBtn = document.createElement('button'); dlBtn.textContent = 'ダウンロード';
        dlBtn.onclick = ()=> downloadItem(it);
        acts.appendChild(dlBtn);
      }

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(perm);
      card.appendChild(acts);
      gridView.appendChild(card);
    }
  }

  function cd(p){ load(p); }

  async function openFile(it){
    try{
      const data = await api('/api/read', { qs: { path: it.path } });
      editingPath = it.path;
      editTitle.textContent = it.path;
      editMeta.textContent = `${fmtSize(data.size)} ・ ${fmtDate(data.mtime)}`;
      editor.value = data.binary ? '(バイナリファイルは編集できません)' : (data.tooLarge ? '(大きすぎるためプレビュー省略)' : data.content || '');
      editWarn.style.display = (data.binary || data.tooLarge) ? 'block' : 'none';
      editWarn.textContent = data.binary ? 'このファイルはバイナリの可能性が高いため編集できません。' :
                           (data.tooLarge ? '2MBを超えるためブラウザ編集は無効化しました。' : '');
      editor.readOnly = !!(data.binary || data.tooLarge || !data.writable);
      saveBtn.disabled = editor.readOnly;
      editorModal.classList.add('show');
    }catch(e){
      alert('読み込み失敗: ' + e.message);
    }
  }

  async function renameItem(it){
    const to = prompt('新しいパスまたは名前を入力', it.path);
    if (!to || to===it.path) return;
    try { await api('/api/rename', { method:'POST', body:{ src: it.path, dest: to } }); await load(); }
    catch(e){ alert('失敗: ' + e.message); }
  }

  async function deleteItem(it){
    if (!confirm(`本当に削除しますか？\n${it.path}`)) return;
    try { await api('/api/delete', { method:'POST', body:{ path: it.path } }); await load(); }
    catch(e){ alert('削除失敗: ' + e.message); }
  }

  function downloadItem(it){
    const url = `/api/download?path=${encodeURIComponent(it.path)}`;
    // open new tab/window for download
    window.open(url, '_blank');
  }

  // Save/Cancel editor
  saveBtn.onclick = async ()=>{
    try{
      await api('/api/write', { method:'POST', body:{ path: editingPath, content: editor.value } });
      editorModal.classList.remove('show');
      await load();
    }catch(e){
      alert('保存失敗: ' + e.message);
    }
  };
  cancelBtn.onclick = ()=> editorModal.classList.remove('show');
  editorModal.addEventListener('click', (e)=> { if (e.target === editorModal) editorModal.classList.remove('show'); });

  // Navigation
  upBtn.onclick = ()=> { if (state.parent) cd(state.parent); };
  goBtn.onclick = ()=> { const p = pathInput.value.trim(); if (p) cd(p); };
  pathInput.addEventListener('keydown', (e)=> { if (e.key === 'Enter') goBtn.click(); });

  // New file/dir
  newFileBtn.onclick = async ()=>{
    const base = state.cwd.endsWith('/') || state.cwd.endsWith('\\') ? state.cwd : state.cwd + '/';
    const p = prompt('作成するファイルのフルパス', base + 'newfile.txt');
    if (!p) return;
    try{ await api('/api/newfile', { method:'POST', body:{ path: p } }); await load(); }
    catch(e){ alert('作成失敗: ' + e.message); }
  };
  newDirBtn.onclick = async ()=>{
    const base = state.cwd.endsWith('/') || state.cwd.endsWith('\\') ? state.cwd : state.cwd + '/';
    const p = prompt('作成するディレクトリのフルパス', base + 'newdir');
    if (!p) return;
    try{ await api('/api/mkdir', { method:'POST', body:{ path: p } }); await load(); }
    catch(e){ alert('作成失敗: ' + e.message); }
  };

  // Upload
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = fileInput.files && fileInput.files[0];
    if (!f) { alert('ファイルを選択してください'); return; }
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('dir', state.cwd); // upload into current directory
      await api('/api/upload', { method: 'POST', body: form });
      setStatus(`アップロード完了: ${f.name}`);
      fileInput.value = '';
      await load();
    } catch (err) {
         alert('アップロード失敗: ' + err.message);
    }
  });

  // 表示モード切り替え
  function setView(mode) {
    state.view = mode;
    viewListBtn.classList.toggle('active', mode === 'list');
    viewGridVBtn.classList.toggle('active', mode === 'grid-v');
    viewGridHBtn.classList.toggle('active', mode === 'grid-h');
    render(); // 再描画
  }

  viewListBtn.onclick = () => setView('list');
  viewGridVBtn.onclick = () => setView('grid-v');
  viewGridHBtn.onclick = () => setView('grid-h');

  // 初期ロード
  load();
})();
