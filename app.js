#!/usr/bin/env node
// Local Web "FTP-like" File Manager (Split, with Upload/Download, List/Grid Views)
// - Binds to 0.0.0.0 (local network OK)
// - Uses uncommon default port 8127 (override via PORT env)
// - Lists/reads/writes/deletes/renames, dir nav, mkdir
// - Honors OS permissions
// - Adds: upload (multipart/form-data), download (res.download)

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');

const app = express();
app.use(express.json({ limit: '10mb' })); // simple JSON bodies
app.use(express.urlencoded({ extended: false }));

// static files for frontend
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Choose filesystem root dynamically (cross-platform)
const FS_ROOT = path.parse(process.cwd()).root; // "/" on Unix, "C:\\" on Windows

// Helper: normalize & absolutize requested path
function resolveAbs(p) {
  if (!p || typeof p !== 'string') return FS_ROOT;
  // Allow absolute or relative: resolve against current working dir
  const abs = path.resolve(p);
  return abs;
}

// Helper: parent path or null if at root
function parentOf(p) {
  const parsed = path.parse(p);
  if (p === parsed.root) return null;
  return path.dirname(p);
}

// Helper: check permissions
function canAccess(p, mode) {
  try {
    fs.accessSync(p, mode);
    return true;
  } catch {
    return false;
  }
}
function canRead(p) { return canAccess(p, fs.constants.R_OK); }
function canWrite(p) { return canAccess(p, fs.constants.W_OK); }

async function statSafe(p) {
  try {
    return await fsp.lstat(p);
  } catch (e) {
    return null;
  }
}

function isTextCandidate(name) {
  // naive: treat common text extensions as editable
  const ext = (name.split('.').pop() || '').toLowerCase();
  const textExt = new Set(['txt','md','json','js','ts','java','py','c','cpp','h','hpp','xml','yml','yaml','toml','ini','conf','cfg','csv','tsv','log','sh','zsh','bash','fish','html','css','scss','less','rs','go','kt','kts','gradle','properties']);
  return textExt.has(ext) || !name.includes('.');
}

// Root -> serve SPA
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// API: list directory
app.get('/api/list', async (req, res) => {
  const reqPath = req.query.path;
  const abs = resolveAbs(reqPath);
  const st = await statSafe(abs);
  if (!st) return res.status(404).json({ error: 'Path not found' });
  if (!st.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  if (!canRead(abs)) return res.status(403).json({ error: 'Permission denied' });

  let entries;
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch (e) {
    return res.status(403).json({ error: 'Cannot read directory' });
  }

  const items = await Promise.all(entries.map(async (d) => {
    const p = path.join(abs, d.name);
    const s = await statSafe(p);
    const base = {
      name: d.name,
      path: p,
      readable: canRead(p),
      writable: canWrite(p),
      type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : 'file',
      size: null,
      mtime: null,
    };
    if (s) {
      base.mtime = s.mtime;
      if (s.isFile()) base.size = s.size;
    }
    return base;
  }));

  res.json({
    path: abs,
    parent: parentOf(abs),
    items: items.sort((a,b)=>{
      // dirs first, then files, then symlinks; then by name
      const rank = t => t==='dir'?0 : t==='file'?1 : 2;
      const r = rank(a.type)-rank(b.type);
      return r!==0 ? r : a.name.localeCompare(b.name);
    })
  });
});

// API: read file (with guards)
app.get('/api/read', async (req, res) => {
  const abs = resolveAbs(req.query.path);
  const st = await statSafe(abs);
  if (!st || !st.isFile()) return res.status(404).json({ error: 'File not found' });
  if (!canRead(abs)) return res.status(403).json({ error: 'Permission denied' });

  const meta = { size: st.size, mtime: st.mtime, writable: canWrite(abs) };

  // limit inline editing to <= 2 MiB
  if (st.size > 2 * 1024 * 1024) {
    return res.json({ ...meta, tooLarge: true });
  }

  try {
    const buf = await fsp.readFile(abs);
    // simple binary heuristic: if contains NUL
    const isBinary = buf.includes(0);
    if (isBinary) return res.json({ ...meta, binary: true });
    const content = buf.toString('utf8');
    return res.json({ ...meta, content });
  } catch (e) {
    return res.status(500).json({ error: 'Read failed' });
  }
});

// API: write file
app.post('/api/write', async (req, res) => {
  const abs = resolveAbs(req.body.path);
  const dir = path.dirname(abs);
  const dirStat = await statSafe(dir);
  if (!dirStat || !dirStat.isDirectory()) return res.status(400).json({ error: 'Parent directory not found' });
  if (!canWrite(abs) && !canWrite(dir)) return res.status(403).json({ error: 'Permission denied' });
  try {
    await fsp.writeFile(abs, req.body.content ?? '', 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Write failed' });
  }
});

// API: new empty file
app.post('/api/newfile', async (req, res) => {
  const abs = resolveAbs(req.body.path);
  const dir = path.dirname(abs);
  const dirStat = await statSafe(dir);
  if (!dirStat || !dirStat.isDirectory()) return res.status(400).json({ error: 'Parent directory not found' });
  if (!canWrite(dir)) return res.status(403).json({ error: 'Permission denied' });
  try {
    await fsp.writeFile(abs, '', { flag: 'wx' }); // fail if exists
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === 'EEXIST') return res.status(409).json({ error: 'Already exists' });
    res.status(500).json({ error: 'Create failed' });
  }
});

// API: mkdir
app.post('/api/mkdir', async (req, res) => {
  const abs = resolveAbs(req.body.path);
  const parent = path.dirname(abs);
  if (!canWrite(parent)) return res.status(403).json({ error: 'Permission denied' });
  try {
    await fsp.mkdir(abs, { recursive: false });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'EEXIST') return res.status(409).json({ error: 'Already exists' });
    res.status(500).json({ error: 'Mkdir failed' });
  }
});

// API: delete (files or directories, recursive)
app.post('/api/delete', async (req, res) => {
  const abs = resolveAbs(req.body.path);
  if (!canWrite(path.dirname(abs))) return res.status(403).json({ error: 'Permission denied' });
  try {
    await fsp.rm(abs, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// API: rename/move
app.post('/api/rename', async (req, res) => {
  const src = resolveAbs(req.body.src);
  const dest = resolveAbs(req.body.dest);
  if (!canWrite(src) || !canWrite(path.dirname(dest))) return res.status(403).json({ error: 'Permission denied' });
  try {
    await fsp.rename(src, dest);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Rename failed' });
  }
});

// --- Upload/Download additions ---

// Upload: multipart/form-data
const upload = multer({ dest: path.join(__dirname, '.uploads_tmp') });

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // Support either a full destination path or a target directory:
    // - body.dest: full path (including filename)
    // - body.dir: directory where the uploaded originalname is placed
    const destParam = req.body.dest && req.body.dest.trim();
    const dirParam = req.body.dir && req.body.dir.trim();

    let targetPath;
    if (destParam) {
      targetPath = resolveAbs(destParam);
    } else if (dirParam) {
      const dirAbs = resolveAbs(dirParam);
      targetPath = path.join(dirAbs, req.file.originalname);
    } else {
      // fallback: current process cwd + original name
      targetPath = path.join(process.cwd(), req.file.originalname);
    }

    const targetDir = path.dirname(targetPath);
    const targetExists = await statSafe(targetPath);
    if (!await statSafe(targetDir) || !(await statSafe(targetDir)).isDirectory()) {
      await fsp.unlink(req.file.path).catch(()=>{});
      return res.status(400).json({ error: 'Target directory not found' });
    }
    if (!canWrite(targetDir)) {
      await fsp.unlink(req.file.path).catch(()=>{});
      return res.status(403).json({ error: 'Permission denied' });
    }
    if (targetExists) {
      await fsp.unlink(req.file.path).catch(()=>{});
      return res.status(409).json({ error: 'Already exists' });
    }

    // Move atomically when possible
    try {
      await fsp.rename(req.file.path, targetPath);
    } catch {
      await fsp.copyFile(req.file.path, targetPath, fs.constants.COPYFILE_EXCL);
      await fsp.unlink(req.file.path).catch(()=>{});
    }
    res.json({ ok: true, path: targetPath });
  } catch (e) {
    // cleanup temp file
    if (req.file && req.file.path) await fsp.unlink(req.file.path).catch(()=>{});
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Download: files only
app.get('/api/download', async (req, res) => {
  const abs = resolveAbs(req.query.path);
  const st = await statSafe(abs);
  if (!st || !st.isFile()) return res.status(404).json({ error: 'File not found' });
  if (!canRead(abs)) return res.status(403).json({ error: 'Permission denied' });
  res.download(abs, path.basename(abs));
});

// Minimal favicon suppression
app.get('/favicon.ico', (_req, res)=> res.status(204).end());

// Start
const PORT = Number(process.env.PORT) || 8127;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Local Web FTP-like running at http://127.0.0.1:${PORT}`);
});
