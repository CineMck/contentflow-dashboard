const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { notifyStatusChange } = require('../utils/notifications');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    if (ext || mime) cb(null, true);
    else cb(new Error('Only image and video files allowed'));
  }
});

// Helper: log activity
function logActivity(postId, userId, action, details) {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (id, post_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), postId, userId, action, details || null);
}

// Helper: create notification
function createNotification(userId, type, title, message, postId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, post_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, type, title, message || null, postId || null);
}

// GET /api/posts - List posts with filters
router.get('/', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const {
      status, approval_status, platform, tag, client_org_id,
      search, sort_by, sort_order, page, limit, priority
    } = req.query;

    let where = ['1=1'];
    let params = [];

    // Role-based filtering
    if (req.user.role === 'client') {
      const orgIds = db.prepare(
        'SELECT client_org_id FROM user_client_orgs WHERE user_id = ?'
      ).all(req.user.id).map(r => r.client_org_id);

      if (orgIds.length > 0) {
        where.push(`p.client_org_id IN (${orgIds.map(() => '?').join(',')})`);
        params.push(...orgIds);
      } else {
        return res.json({ posts: [], total: 0 });
      }
    }

    if (status) { where.push('p.status = ?'); params.push(status); }
    if (approval_status) { where.push('p.approval_status = ?'); params.push(approval_status); }
    if (platform) { where.push('p.platform = ?'); params.push(platform); }
    if (client_org_id) { where.push('p.client_org_id = ?'); params.push(client_org_id); }
    if (priority) { where.push('p.priority = ?'); params.push(priority); }
    if (search) {
      where.push('(p.title LIKE ? OR p.caption LIKE ? OR p.hashtags LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (tag) {
      where.push(`p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)`);
      params.push(tag);
    }

    const validSorts = ['created_at', 'updated_at', 'scheduled_date', 'title', 'priority', 'status'];
    const orderBy = validSorts.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'asc' ? 'ASC' : 'DESC';

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * pageSize;

    const whereClause = where.join(' AND ');

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM posts p WHERE ${whereClause}
    `).get(...params).count;

    const posts = db.prepare(`
      SELECT p.*,
        u.name as creator_name, u.avatar_color as creator_color,
        co.name as client_org_name,
        au.name as assignee_name
      FROM posts p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users au ON p.assigned_to = au.id
      LEFT JOIN client_orgs co ON p.client_org_id = co.id
      WHERE ${whereClause}
      ORDER BY p.${orderBy} ${order}
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    // Fetch media and tags for each post
    const mediaStmt = db.prepare('SELECT * FROM media WHERE post_id = ? ORDER BY sort_order');
    const tagStmt = db.prepare(`
      SELECT t.* FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `);
    const commentCountStmt = db.prepare('SELECT COUNT(*) as count FROM comments WHERE post_id = ?');

    const enrichedPosts = posts.map(post => ({
      ...post,
      media: mediaStmt.all(post.id),
      tags: tagStmt.all(post.id),
      comment_count: commentCountStmt.get(post.id).count
    }));

    res.json({ posts: enrichedPosts, total, page: pageNum, limit: pageSize });
  } catch (err) {
    console.error('List posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/posts/:id - Get single post with full details
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare(`
      SELECT p.*,
        u.name as creator_name, u.avatar_color as creator_color,
        co.name as client_org_name,
        au.name as assignee_name
      FROM posts p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users au ON p.assigned_to = au.id
      LEFT JOIN client_orgs co ON p.client_org_id = co.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!post) return res.status(404).json({ error: 'Post not found' });

    post.media = db.prepare('SELECT * FROM media WHERE post_id = ? ORDER BY sort_order').all(post.id);
    post.tags = db.prepare(`
      SELECT t.* FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?
    `).all(post.id);
    post.comments = db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color, u.role as user_role
      FROM comments c JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ? ORDER BY c.created_at ASC
    `).all(post.id);
    post.versions = db.prepare(
      'SELECT * FROM post_versions WHERE post_id = ? ORDER BY version DESC'
    ).all(post.id);
    post.activity = db.prepare(`
      SELECT al.*, u.name as user_name
      FROM activity_log al JOIN users u ON al.user_id = u.id
      WHERE al.post_id = ? ORDER BY al.created_at DESC LIMIT 50
    `).all(post.id);

    res.json(post);
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts - Create new post
router.post('/', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const db = getDb();
    const {
      title, caption, hashtags, platform, aspect_ratio,
      status, client_org_id, scheduled_date, priority, assigned_to,
      tags, media_items
    } = req.body;

    if (!title || !platform) {
      return res.status(400).json({ error: 'Title and platform required' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO posts (id, title, caption, hashtags, platform, aspect_ratio, status, client_org_id, scheduled_date, priority, assigned_to, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, caption || null, hashtags || null, platform,
      aspect_ratio || '9:16', status || 'pending', client_org_id || null,
      scheduled_date || null, priority || 'normal', assigned_to || null,
      req.user.id
    );

    // Save initial version
    db.prepare(`
      INSERT INTO post_versions (id, post_id, version, title, caption, hashtags, changed_by, change_note, snapshot)
      VALUES (?, ?, 1, ?, ?, ?, ?, 'Initial version', ?)
    `).run(uuidv4(), id, title, caption, hashtags, req.user.id, JSON.stringify({ title, caption, hashtags, platform }));

    // Add tags
    if (tags && tags.length > 0) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
      for (const tagId of tags) {
        insertTag.run(id, tagId);
      }
    }

    // Add media items (URLs, Vimeo links, etc.)
    if (media_items && media_items.length > 0) {
      const insertMedia = db.prepare(`
        INSERT INTO media (id, post_id, type, url, filename, thumbnail_url, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      media_items.forEach((item, i) => {
        insertMedia.run(uuidv4(), id, item.type, item.url, item.filename || null, item.thumbnail_url || null, i);
      });
    }

    logActivity(id, req.user.id, 'created', `Post "${title}" created`);

    // Notify assigned user
    if (assigned_to) {
      createNotification(assigned_to, 'assignment', 'New Post Assigned', `You've been assigned to review "${title}"`, id);
    }

    res.status(201).json({ id, message: 'Post created' });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/posts/:id - Update post
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const {
      title, caption, hashtags, platform, aspect_ratio,
      status, scheduled_date, priority, assigned_to, tags, media_items
    } = req.body;

    const newVersion = post.version + 1;

    db.prepare(`
      UPDATE posts SET
        title = COALESCE(?, title),
        caption = COALESCE(?, caption),
        hashtags = COALESCE(?, hashtags),
        platform = COALESCE(?, platform),
        aspect_ratio = COALESCE(?, aspect_ratio),
        status = COALESCE(?, status),
        scheduled_date = COALESCE(?, scheduled_date),
        priority = COALESCE(?, priority),
        assigned_to = COALESCE(?, assigned_to),
        version = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title, caption, hashtags, platform, aspect_ratio,
      status, scheduled_date, priority, assigned_to, newVersion,
      req.params.id
    );

    // Save version snapshot
    db.prepare(`
      INSERT INTO post_versions (id, post_id, version, title, caption, hashtags, changed_by, change_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), req.params.id, newVersion, title || post.title, caption || post.caption, hashtags || post.hashtags, req.user.id, 'Updated');

    // Update tags if provided
    if (tags) {
      db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(req.params.id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
      for (const tagId of tags) {
        insertTag.run(req.params.id, tagId);
      }
    }

    // Update media if provided
    if (media_items) {
      db.prepare('DELETE FROM media WHERE post_id = ?').run(req.params.id);
      const insertMedia = db.prepare(`
        INSERT INTO media (id, post_id, type, url, filename, thumbnail_url, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      media_items.forEach((item, i) => {
        insertMedia.run(uuidv4(), req.params.id, item.type, item.url, item.filename || null, item.thumbnail_url || null, i);
      });
    }

    logActivity(req.params.id, req.user.id, 'updated', `Post updated to version ${newVersion}`);

    res.json({ message: 'Post updated', version: newVersion });
  } catch (err) {
    console.error('Update post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/approve - Quick approve
router.post('/:id/approve', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    db.prepare(`
      UPDATE posts SET approval_status = 'approved', status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);

    logActivity(req.params.id, req.user.id, 'approved', `Post approved by ${req.user.name}`);

    // Notify creator
    if (post.created_by !== req.user.id) {
      createNotification(post.created_by, 'approval', 'Post Approved', `"${post.title}" has been approved`, post.id);
    }

    // Send email notification
    notifyStatusChange({ post, newStatus: 'approved', changedBy: req.user, db });

    res.json({ message: 'Post approved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/reject - Quick reject
router.post('/:id/reject', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { reason } = req.body;

    db.prepare(`
      UPDATE posts SET approval_status = 'rejected', status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);

    logActivity(req.params.id, req.user.id, 'rejected', reason || `Post rejected by ${req.user.name}`);

    if (post.created_by !== req.user.id) {
      createNotification(post.created_by, 'rejection', 'Post Rejected', reason || `"${post.title}" was rejected`, post.id);
    }

    // Send email notification
    notifyStatusChange({ post, newStatus: 'rejected', changedBy: req.user, db });

    res.json({ message: 'Post rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/request-revision
router.post('/:id/request-revision', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { note } = req.body;

    db.prepare(`
      UPDATE posts SET approval_status = 'needs_revision', status = 'needs_revision', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);

    logActivity(req.params.id, req.user.id, 'revision_requested', note || 'Revision requested');

    if (post.created_by !== req.user.id) {
      createNotification(post.created_by, 'revision', 'Revision Requested', note || `"${post.title}" needs revisions`, post.id);
    }

    // Send email notification
    notifyStatusChange({ post, newStatus: 'needs_revision', changedBy: req.user, db });

    res.json({ message: 'Revision requested' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/upload - Upload media files
router.post('/:id/upload', authenticateToken, upload.array('files', 10), (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const mediaItems = [];
    const maxSort = db.prepare('SELECT MAX(sort_order) as max FROM media WHERE post_id = ?').get(req.params.id).max || 0;

    req.files.forEach((file, i) => {
      const id = uuidv4();
      const type = file.mimetype.startsWith('video') ? 'video' : 'image';
      const url = `/uploads/${file.filename}`;

      db.prepare(`
        INSERT INTO media (id, post_id, type, url, filename, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, type, url, file.originalname, maxSort + i + 1);

      mediaItems.push({ id, type, url, filename: file.originalname });
    });

    logActivity(req.params.id, req.user.id, 'media_uploaded', `${req.files.length} file(s) uploaded`);

    res.json({ media: mediaItems });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/posts/:id
router.delete('/:id', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const db = getDb();
    const post = db.prepare('SELECT id, title FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    logActivity(null, req.user.id, 'deleted', `Post "${post.title}" deleted`);

    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/bulk-action - Bulk approve/reject
router.post('/bulk-action', authenticateToken, (req, res) => {
  try {
    const { post_ids, action, reason } = req.body;
    if (!post_ids || !post_ids.length || !action) {
      return res.status(400).json({ error: 'post_ids and action required' });
    }

    const db = getDb();
    const validActions = { approve: 'approved', reject: 'rejected', needs_revision: 'needs_revision', schedule: 'scheduled' };
    const newStatus = validActions[action];
    if (!newStatus) return res.status(400).json({ error: 'Invalid action' });

    const update = db.prepare(`
      UPDATE posts SET approval_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);

    let count = 0;
    for (const pid of post_ids) {
      const result = update.run(newStatus, newStatus, pid);
      if (result.changes > 0) {
        logActivity(pid, req.user.id, action, reason || `Bulk ${action}`);
        count++;
      }
    }

    res.json({ message: `${count} posts updated`, action });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// === Tags ===

// GET /api/posts/tags/all
router.get('/tags/all', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/tags
router.post('/tags', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Tag name required' });

    const db = getDb();

// PUT /api/posts/tags/:id
router.put('/tags/:id', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const db = getDb();
    const existing = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tag not found' });
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color || existing.color, req.params.id);
    res.json({ id: req.params.id, name, color: color || existing.color });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/posts/tags/:id
router.delete('/tags/:id', authenticateToken, requireRole('super_admin', 'manager'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tag not found' });
    db.prepare('DELETE FROM post_tags WHERE tag_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
    const id = uuidv4();
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, name, color || '#3B82F6');

    res.status(201).json({ id, name, color: color || '#3B82F6' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// === Notifications ===

// GET /api/posts/notifications/mine
router.get('/notifications/mine', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const notifications = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/posts/notifications/:id/read
router.put('/notifications/:id/read', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
