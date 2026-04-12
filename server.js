const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload dirs exist
['uploads/music', 'uploads/fx'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type;
    if (type !== 'music' && type !== 'fx') return cb(new Error('Invalid type'));
    cb(null, `uploads/${type}`);
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3' ||
        file.originalname.toLowerCase().endsWith('.mp3')) {
      cb(null, true);
    } else {
      cb(new Error('Only MP3 files are allowed'));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// List files
app.get('/api/files/:type', (req, res) => {
  const type = req.params.type;
  if (type !== 'music' && type !== 'fx') return res.status(400).json({ error: 'Invalid type' });
  const dir = `uploads/${type}`;
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.mp3'))
    .map(f => ({ name: f, url: `/uploads/${type}/${encodeURIComponent(f)}` }));
  res.json(files);
});

// Upload file
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    name: req.file.filename,
    url: `/uploads/${req.params.type}/${encodeURIComponent(req.file.filename)}`
  });
});

// Delete file
app.delete('/api/files/:type/:name', (req, res) => {
  const type = req.params.type;
  if (type !== 'music' && type !== 'fx') return res.status(400).json({ error: 'Invalid type' });
  const filename = decodeURIComponent(req.params.name).replace(/[\/\\]/g, '');
  const filepath = path.join(__dirname, 'uploads', type, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filepath);
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`JuxBox running on http://localhost:${PORT}`);
});
