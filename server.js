require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database');

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start
initializeDatabase();

// Auto-seed on first run if database is empty
const { getDb } = require('./database');
const userCount = getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  console.log('  Empty database detected â running auto-seed...');
  require('child_process').execSync('node seed.js', { stdio: 'inherit', cwd: __dirname });
}

const HOST = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost';
app.listen(PORT, HOST, () => {
  console.log(`\n  ââââââââââââââââââââââââââââââââââââââââââââ`);
  console.log(`  â   ContentFlow Dashboard                  â`);
  console.log(`  â   Running on http://${HOST}:${PORT}            â`);
  console.log(`  ââââââââââââââââââââââââââââââââââââââââââââ\n`);
});

module.exports = app;
