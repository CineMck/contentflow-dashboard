const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { notifyNewComment } = require('../utils/notifications');

const router = express.Router();

// GET /api/comments/:postId - Get all comments for a post
router.get('/:postId', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const comments = db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color, u.role as user_role
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(req.params.postId);

    // Build threaded structure
    const rootComments = [];
    const commentMap = {};

    comments.forEach(c => {
      c.replies = [];
      commentMap[c.id] = c;
    });

    comments.forEach(c => {
      if (c.parent_id && commentMap[c.parent_id]) {
        commentMap[c.parent_id].replies.push(c);
      } else {
        rootComments.push(c);
      }
    });

    res.json(rootComments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/comments/:postId - Add comment
router.post('/:postId', authenticateToken, (req, res) => {
  try {
    const { content, parent_id } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content required' });
    }

    const db = getDb();

    // Verify post exists
    const post = db.prepare('SELECT id, title, created_by FROM posts WHERE id = ?').get(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO comments (id, post_id, user_id, content, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.params.postId, req.user.id, content.trim(), parent_id || null);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (id, post_id, user_id, action, details)
      VALUES (?, ?, ?, 'commented', ?)
    `).run(uuidv4(), req.params.postId, req.user.id, `${req.user.name} commented`);

    // Notify post creator if different user
    if (post.created_by !== req.user.id) {
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, message, post_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), post.created_by, 'comment', `${req.user.name} commented on "${post.title}"`, req.params.postId);
    }

    // Notify @mentioned users
    const mentionRegex = /@([\w\s]+?)(?=\s@|\s*$|[.,!?;:])/g;
    let match;
    const mentionedNames = new Set();
    while ((match = mentionRegex.exec(content)) !== null) {
      mentionedNames.add(match[1].trim());
    }
    if (mentionedNames.size > 0) {
      const allUsers = db.prepare('SELECT id, name FROM users').all();
      for (const user of allUsers) {
        if (mentionedNames.has(user.name) && user.id !== req.user.id) {
          db.prepare(`
            INSERT INTO notifications (id, user_id, type, message, post_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(uuidv4(), user.id, 'mention', `${req.user.name} mentioned you in a comment on "${post.title}"`, req.params.postId);
        }
      }
    }

    // If replying, notify original commenter
    if (parent_id) {
      const parentComment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parent_id);
      if (parentComment && parentComment.user_id !== req.user.id) {
        db.prepare(`
          INSERT INTO notifications (id, user_id, type, title, message, post_id)
          VALUES (?, ?, 'reply', ?, ?, ?)
        `).run(uuidv4(), parentComment.user_id, 'reply', 'New Reply', `${req.user.name} replied to your comment`, post.id);
      }
    }

    const newComment = db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color, u.role as user_role
      FROM comments c JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(id);

    // Send email notification
    notifyNewComment({ post, comment: { content }, commenter: req.user, db });

    newComment.replies = [];

    res.status(201).json(newComment);
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/comments/:postId/:commentId - Edit comment
router.put('/:postId/:commentId', authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content required' });
    }

    const db = getDb();
    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(req.params.commentId, req.params.postId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admins can edit
    if (comment.user_id !== req.user.id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot edit this comment' });
    }

    db.prepare('UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content.trim(), req.params.commentId);

    res.json({ message: 'Comment updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/comments/:postId/:commentId
router.delete('/:postId/:commentId', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(req.params.commentId, req.params.postId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.user_id !== req.user.id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete this comment' });
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.commentId);

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
